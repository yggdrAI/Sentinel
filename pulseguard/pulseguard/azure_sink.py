from __future__ import annotations

import json
import logging
import queue
import threading
from typing import Any

log = logging.getLogger("pulseguard.azure")


class AzureSink:
    """Optional Event Hubs / Fabric Eventstream producer. Never crashes the demo."""

    def __init__(
        self,
        enabled: bool,
        connection_string: str,
        hub_name: str,
        batch_size: int = 20,
    ) -> None:
        self.enabled = bool(
            enabled and connection_string.strip() and hub_name.strip()
        )
        self.connection_string = connection_string
        self.hub_name = hub_name
        self.batch_size = max(1, batch_size)
        self._q: queue.Queue[dict[str, Any]] = queue.Queue(maxsize=5000)
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self.sent = 0
        self.dropped = 0
        self.errors = 0
        if self.enabled:
            self._thread = threading.Thread(target=self._loop, name="azure-sink", daemon=True)
            self._thread.start()

    def offer(self, payload: dict[str, Any]) -> None:
        if not self.enabled:
            return
        try:
            self._q.put_nowait(payload)
        except queue.Full:
            self.dropped += 1

    def _loop(self) -> None:
        producer = None
        try:
            from azure.eventhub import EventData, EventHubProducerClient

            producer = EventHubProducerClient.from_connection_string(
                conn_str=self.connection_string,
                eventhub_name=self.hub_name,
            )
            batch: list[dict[str, Any]] = []
            while not self._stop.is_set():
                timed_out = False
                try:
                    item = self._q.get(timeout=0.4)
                    batch.append(item)
                except queue.Empty:
                    timed_out = True
                if not batch:
                    continue
                if len(batch) < self.batch_size and not timed_out:
                    continue
                try:
                    event_batch = producer.create_batch()
                    for row in batch:
                        event_batch.add(EventData(json.dumps(row)))
                    producer.send_batch(event_batch)
                    self.sent += len(batch)
                except Exception:
                    self.errors += 1
                    log.exception("Azure Event Hub send failed")
                batch.clear()
        except Exception:
            self.errors += 1
            log.exception("Azure Event Hub client failed to start; sink disabled")
        finally:
            if producer is not None:
                try:
                    producer.close()
                except Exception:
                    pass

    def status(self) -> dict[str, Any]:
        return {
            "enabled": self.enabled,
            "sent": self.sent,
            "dropped": self.dropped,
            "errors": self.errors,
            "queued": self._q.qsize() if self.enabled else 0,
            "hub": self.hub_name if self.enabled else "",
        }

    def close(self) -> None:
        self._stop.set()
