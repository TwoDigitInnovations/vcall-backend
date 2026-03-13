'use strict';

const path = require('path');
const { GoogleAuth } = require('google-auth-library');

const FIREBASE_PROJECT_ID = 'digit-vcall';
const SERVICE_ACCOUNT_PATH = path.join(__dirname, '..', 'firebase-service-account.json');

let _fcmAccessToken = null;
let _fcmTokenExpiresAt = 0;

// ── Safe fetch — works with node-fetch v2, v3, and Node 18+ native fetch ─────
async function safeFetch(url, options) {
    // Node 18+ has native fetch
    if (typeof globalThis.fetch === 'function') {
        return globalThis.fetch(url, options);
    }
    // node-fetch v2 (CommonJS)
    try {
        const nodeFetch = require('node-fetch');
        const fn = nodeFetch.default || nodeFetch;
        return fn(url, options);
    } catch (e) {
        throw new Error('No fetch available. Run: npm install node-fetch@2');
    }
}

async function getFcmAccessToken() {
    if (_fcmAccessToken && Date.now() < _fcmTokenExpiresAt - 300000) {
        return _fcmAccessToken;
    }
    try {
        const auth = new GoogleAuth({
            keyFile: SERVICE_ACCOUNT_PATH,
            scopes: ['https://www.googleapis.com/auth/firebase.messaging'],
        });
        const client = await auth.getClient();
        const token = await client.getAccessToken();
        _fcmAccessToken = token.token;
        _fcmTokenExpiresAt = token.res?.data?.expiry_date || (Date.now() + 3600000);
        return _fcmAccessToken;
    } catch (err) {
        console.error('FCM auth error:', err.message);
        return null;
    }
}

async function sendFcmV1(fcmToken, callData) {
    const accessToken = await getFcmAccessToken();
    if (!accessToken) return false;

    const { callerId, callerName, roomId } = callData;
    const url = `https://fcm.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/messages:send`;

    const body = JSON.stringify({
        message: {
            token: fcmToken,

            // DATA ONLY — no notification block
            // This ensures onMessageReceived() fires even when app is killed
            // Our VcallFirebaseMessagingService handles the UI natively
            data: {
                type: 'incoming_call',
                callerId: callerId || '',
                callerName: callerName || '',
                roomId: roomId || '',
            },

            android: {
                priority: 'high',
                ttl: '60s',
            },
        },
    });

    try {
        const res = await safeFetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${accessToken}`,
            },
            body,
        });
        const result = await res.json();
        if (result.name) return true;
        console.error('FCM v1 error:', JSON.stringify(result));
        return false;
    } catch (err) {
        console.error('FCM v1 fetch error:', err.message);
        return false;
    }
}

module.exports = { sendFcmV1 };