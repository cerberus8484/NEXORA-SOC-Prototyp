'use strict';

const { Notification } = require('../domain/Notification');

const DEFAULT_LIMIT = 50;

/**
 * InMemoryNotificationRepository — Tests/Dev ohne DB.
 * Alle Operationen sind user-scoped: kein Cross-User-Zugriff möglich.
 */
class InMemoryNotificationRepository {
  constructor() {
    // id → plain-object (toJSON-Form)
    this._m = new Map();
  }

  /** Löscht alle gespeicherten Notifications (Test-Hilfsmethode). */
  clear() { this._m.clear(); }

  /**
   * Speichert eine Notification (Notification-Instanz oder plain-Objekt).
   * Gibt immer ein plain-Objekt zurück.
   */
  async create(data) {
    const plain = data instanceof Notification ? data.toJSON() : { ...data };
    this._m.set(plain.id, plain);
    return plain;
  }

  /**
   * Gibt Notifications eines Users zurück (neueste zuerst).
   * @param {string} userId
   * @param {{ unreadOnly?: boolean, limit?: number }} opts
   * @returns {Promise<object[]>}
   */
  async listForUser(userId, { unreadOnly = false, limit = DEFAULT_LIMIT } = {}) {
    let items = [...this._m.values()].filter((n) => n.userId === userId);
    if (unreadOnly) items = items.filter((n) => !n.read);
    items.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    return items.slice(0, limit);
  }

  /**
   * Zählt ungelesene Notifications eines Users.
   * @param {string} userId
   * @returns {Promise<number>}
   */
  async unreadCount(userId) {
    return [...this._m.values()].filter((n) => n.userId === userId && !n.read).length;
  }

  /**
   * Markiert eine Notification als gelesen — NUR wenn sie dem User gehört.
   * Gibt das aktualisierte Objekt zurück oder null bei Fremdzugriff / nicht gefunden.
   * @param {string} id
   * @param {string} userId
   * @returns {Promise<object|null>}
   */
  async markRead(id, userId) {
    const n = this._m.get(id);
    if (!n || n.userId !== userId) return null;
    const updated = { ...n, read: true };
    this._m.set(id, updated);
    return updated;
  }

  /**
   * Markiert alle ungelesenen Notifications eines Users als gelesen.
   * @param {string} userId
   * @returns {Promise<number>} Anzahl aktualisierter Notifications
   */
  async markAllRead(userId) {
    let count = 0;
    for (const [id, n] of this._m.entries()) {
      if (n.userId === userId && !n.read) {
        this._m.set(id, { ...n, read: true });
        count++;
      }
    }
    return count;
  }
}

module.exports = { InMemoryNotificationRepository };
