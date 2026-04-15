export class LRUNode {
  constructor(key, value, ttlMs) {
    this.key = key;
    this.value = value;
    this.expiresAt = Date.now() + ttlMs;
    this.prev = null;
    this.next = null;
  }
}

export class LRUCache {
  constructor(capacity) {
    this.capacity = capacity;
    this.map = new Map();
    this.head = new LRUNode(null, null, Infinity);
    this.tail = new LRUNode(null, null, Infinity);
    this.head.next = this.tail;
    this.tail.prev = this.head;
  }

  _detach(node) {
    node.prev.next = node.next;
    node.next.prev = node.prev;
  }

  _attachFront(node) {
    node.next = this.head.next;
    node.prev = this.head;
    this.head.next.prev = node;
    this.head.next = node;
  }

  get(key) {
    const node = this.map.get(key);
    if (!node) return null;
    if (Date.now() > node.expiresAt) {
      this._detach(node);
      this.map.delete(key);
      return null;
    }
    this._detach(node);
    this._attachFront(node);
    return node.value;
  }

  put(key, value, ttlMs) {
    if (this.map.has(key)) {
      this._detach(this.map.get(key));
      this.map.delete(key);
    }

    const node = new LRUNode(key, value, ttlMs);
    this._attachFront(node);
    this.map.set(key, node);

    if (this.map.size > this.capacity) {
      const lru = this.tail.prev;
      this._detach(lru);
      this.map.delete(lru.key);
    }
  }

  get size() {
    return this.map.size;
  }
}
