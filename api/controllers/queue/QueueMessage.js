//For normalizing every message into a common Logiks format.

class QueueMessage {

    constructor({
        id,
        queue,
        payload,
        headers = {},
        attempts = 0,
        timestamp = Date.now(),
        raw = null
    }) {

        this.id = id;
        this.queue = queue;
        this.payload = payload;
        this.headers = headers;
        this.attempts = attempts;
        this.timestamp = timestamp;

        // Broker specific object
        this.raw = raw;
    }

    toString = function() {
        return {
            id: this.id,
            queue: this.queue,
            payload: this.payload,
            headers: this.headers,
            attempts: this.attempts,
            timestamp: this.timestamp,
        }
    }
}

module.exports = QueueMessage;