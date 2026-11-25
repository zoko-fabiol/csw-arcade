import crypto from 'node:crypto';
import fs from 'node:fs';
import https from 'node:https';
import http from 'node:http';
import path from 'node:path';

function b64UrlEncode(buf) {
  return Buffer.from(buf)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function b64UrlDecode(str) {
  const clean = String(str || '').replace(/-/g, '+').replace(/_/g, '/');
  const pad = clean.length % 4 === 0 ? '' : '='.repeat(4 - (clean.length % 4));
  return Buffer.from(clean + pad, 'base64');
}

export class WebPushHub {
  constructor({ dataDir = path.resolve(process.cwd(), '.csw-data'), subject = 'mailto:contact@csw-arcade.tech' } = {}) {
    this.dataDir = dataDir;
    this.subject = process.env.VAPID_SUBJECT || subject;
    this.keysPath = path.join(this.dataDir, 'vapid-keys.json');
    this.subsPath = path.join(this.dataDir, 'push-subscriptions.json');
    this.subscriptionsByUid = new Map(); // uid -> Map<endpoint, subObj>
    this.saveTimer = null;

    this._ensureDir();
    this.vapid = this._loadOrCreateVapidKeys();
    this._loadSubscriptions();
  }

  _ensureDir() {
    try {
      if (!fs.existsSync(this.dataDir)) {
        fs.mkdirSync(this.dataDir, { recursive: true });
      }
    } catch {}
  }

  _loadOrCreateVapidKeys() {
    try {
      if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_JWK) {
        const jwk = JSON.parse(process.env.VAPID_PRIVATE_JWK);
        const privKey = crypto.createPrivateKey({ key: jwk, format: 'jwk' });
        return { publicKey: process.env.VAPID_PUBLIC_KEY, jwk, privKey };
      }
      if (fs.existsSync(this.keysPath)) {
        const saved = JSON.parse(fs.readFileSync(this.keysPath, 'utf8'));
        if (saved?.publicKey && saved?.jwk) {
          const privKey = crypto.createPrivateKey({ key: saved.jwk, format: 'jwk' });
          return { publicKey: saved.publicKey, jwk: saved.jwk, privKey };
        }
      }
    } catch {}

    const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const jwk = privateKey.export({ format: 'jwk' });
    const rawPub = Buffer.concat([Buffer.from([0x04]), b64UrlDecode(jwk.x), b64UrlDecode(jwk.y)]);
    const publicKey = b64UrlEncode(rawPub);
    try {
      fs.writeFileSync(this.keysPath, JSON.stringify({ publicKey, jwk }, null, 2), { mode: 0o600 });
    } catch {}
    return { publicKey, jwk, privKey: privateKey };
  }

  _loadSubscriptions() {
    try {
      if (!fs.existsSync(this.subsPath)) return;
      const raw = JSON.parse(fs.readFileSync(this.subsPath, 'utf8'));
      if (!raw || typeof raw !== 'object') return;
      for (const [uid, list] of Object.entries(raw)) {
        if (!Array.isArray(list)) continue;
        const map = new Map();
        for (const sub of list) {
          if (sub?.endpoint && sub?.keys?.p256dh && sub?.keys?.auth) {
            map.set(sub.endpoint, sub);
          }
        }
        if (map.size > 0) this.subscriptionsByUid.set(uid, map);
      }
    } catch {}
  }

  _scheduleSave() {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      try {
        const out = {};
        for (const [uid, map] of this.subscriptionsByUid.entries()) {
          if (map.size > 0) out[uid] = Array.from(map.values());
        }
        fs.writeFileSync(this.subsPath, JSON.stringify(out, null, 2), 'utf8');
      } catch {}
    }, 500);
  }

  getPublicKey() {
    return this.vapid.publicKey;
  }

  addSubscription(uid, subscription) {
    if (!uid || !subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
      return false;
    }
    let map = this.subscriptionsByUid.get(uid);
    if (!map) {
      map = new Map();
      this.subscriptionsByUid.set(uid, map);
    }
    map.set(subscription.endpoint, {
      endpoint: subscription.endpoint,
      expirationTime: subscription.expirationTime || null,
      keys: {
        p256dh: subscription.keys.p256dh,
        auth: subscription.keys.auth,
      },
      updatedAt: Date.now(),
    });
    // Limiter à 5 appareils max par joueur
    if (map.size > 5) {
      const oldestKey = map.keys().next().value;
      map.delete(oldestKey);
    }
    this._scheduleSave();
    return true;
  }

  removeSubscription(uid, endpoint) {
    if (!endpoint) return false;
    let removed = false;
    if (uid && this.subscriptionsByUid.has(uid)) {
      removed = this.subscriptionsByUid.get(uid).delete(endpoint);
    } else {
      for (const map of this.subscriptionsByUid.values()) {
        if (map.delete(endpoint)) removed = true;
      }
    }
    if (removed) this._scheduleSave();
    return removed;
  }

  _createVapidAuthHeader(endpointUrl) {
    const parsed = new URL(endpointUrl);
    const aud = `${parsed.protocol}//${parsed.host}`;
    const exp = Math.floor(Date.now() / 1000) + 12 * 3600;
    const headerB64 = b64UrlEncode(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
    const payloadB64 = b64UrlEncode(JSON.stringify({ aud, exp, sub: this.subject }));
    const unsigned = `${headerB64}.${payloadB64}`;
    const sig = crypto.sign('sha256', Buffer.from(unsigned, 'utf8'), {
      key: this.vapid.privKey,
      dsaEncoding: 'ieee-p1363',
    });
    const jwt = `${unsigned}.${b64UrlEncode(sig)}`;
    return `vapid t=${jwt}, k=${this.vapid.publicKey}`;
  }

  _encryptPayload(subscription, payloadObj) {
    const plaintext = Buffer.from(JSON.stringify(payloadObj), 'utf8');
    const uaPublic = b64UrlDecode(subscription.keys.p256dh);
    const authSecret = b64UrlDecode(subscription.keys.auth);

    const ecdh = crypto.createECDH('prime256v1');
    ecdh.generateKeys();
    const asPublic = ecdh.getPublicKey();
    const sharedSecret = ecdh.computeSecret(uaPublic);

    const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0', 'utf8'), uaPublic, asPublic]);
    const ikm = Buffer.from(crypto.hkdfSync('sha256', sharedSecret, authSecret, keyInfo, 32));

    const salt = crypto.randomBytes(16);
    const cek = Buffer.from(
      crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0', 'utf8'), 16)
    );
    const nonce = Buffer.from(
      crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0', 'utf8'), 12)
    );

    const cipher = crypto.createCipheriv('aes-128-gcm', cek, nonce);
    const padded = Buffer.concat([plaintext, Buffer.from([0x02])]);
    const encrypted = Buffer.concat([cipher.update(padded), cipher.final(), cipher.getAuthTag()]);

    const header = Buffer.alloc(16 + 4 + 1 + asPublic.length);
    salt.copy(header, 0);
    header.writeUInt32BE(4096, 16);
    header.writeUInt8(asPublic.length, 20);
    asPublic.copy(header, 21);

    return Buffer.concat([header, encrypted]);
  }

  _postEncryptedPush(subscription, bodyBuffer) {
    return new Promise((resolve) => {
      try {
        const target = new URL(subscription.endpoint);
        const mod = target.protocol === 'http:' ? http : https;
        const req = mod.request(
          {
            protocol: target.protocol,
            hostname: target.hostname,
            port: target.port || (target.protocol === 'http:' ? 80 : 443),
            path: `${target.pathname}${target.search}`,
            method: 'POST',
            headers: {
              Authorization: this._createVapidAuthHeader(subscription.endpoint),
              'Content-Encoding': 'aes128gcm',
              'Content-Type': 'application/octet-stream',
              'Content-Length': bodyBuffer.length,
              TTL: '86400',
              Urgency: 'high',
            },
            timeout: 8000,
          },
          (res) => {
            res.resume();
            resolve(res.statusCode || 0);
          }
        );
        req.on('error', () => resolve(0));
        req.on('timeout', () => {
          req.destroy();
          resolve(0);
        });
        req.write(bodyBuffer);
        req.end();
      } catch {
        resolve(0);
      }
    });
  }

  async sendToUser(uid, notification) {
    const map = this.subscriptionsByUid.get(uid);
    if (!map || map.size === 0) return { sent: 0 };

    const payload = {
      title: notification.title || 'CSW-Arcade',
      body: notification.body || '',
      icon: notification.icon || '/icons/icon-192.png',
      badge: notification.badge || '/favicon.png',
      tag: notification.tag || `csw_${Date.now()}`,
      url: notification.url || '/',
      data: notification.data || {},
    };

    let sent = 0;
    const staleEndpoints = [];

    for (const [endpoint, sub] of map.entries()) {
      try {
        const bodyBuf = this._encryptPayload(sub, payload);
        const status = await this._postEncryptedPush(sub, bodyBuf);
        if (status >= 200 && status < 300) {
          sent += 1;
        } else if (status === 404 || status === 410) {
          staleEndpoints.push(endpoint);
        }
      } catch {}
    }

    for (const ep of staleEndpoints) {
      map.delete(ep);
    }
    if (staleEndpoints.length > 0) this._scheduleSave();

    return { sent };
  }
}
