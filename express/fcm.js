'use strict';

// const fetch = require('node-fetch');
const path = require('path');
const { GoogleAuth } = require('google-auth-library');

const FIREBASE_PROJECT_ID = 'digit-vcall';
// const SERVICE_ACCOUNT_PATH = path.join(__dirname, 'firebase-service-account.json');  // e.g. 'digit-vcall'
const SERVICE_ACCOUNT_PATH = path.join(__dirname, '..', 'firebase-service-account.json');

let _fcmAccessToken = null;
let _fcmTokenExpiresAt = 0;

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

    const body = {
        message: {
            token: fcmToken,
            notification: {
                title: `📞 ${callerName || callerId} is calling`,
                body: 'Tap to answer',
            },
            data: {
                type: 'incoming_call',
                callerId: callerId || '',
                callerName: callerName || '',
                roomId: roomId || '',
            },
            android: {
                priority: 'high',
                ttl: '60s',
                notification: {
                    channel_id: 'incoming_call_v3',
                    sound: 'ringtone',
                    visibility: 'PUBLIC',
                    default_vibrate_timings: true,
                    notification_priority: 'PRIORITY_MAX',
                    default_sound: true,
                    click_action: 'INCOMING_CALL_ANSWER',
                },
            },
        },
    };

    try {
        const res = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${accessToken}`,
            },
            body: JSON.stringify(body),
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