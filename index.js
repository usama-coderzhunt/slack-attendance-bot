const { App } = require('@slack/bolt');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const moment = require('moment');
require('dotenv').config();

// Initialize Slack app
const app = new App({
    token: process.env.SLACK_BOT_TOKEN,
    signingSecret: process.env.SLACK_SIGNING_SECRET,
    socketMode: true,
    appToken: process.env.SLACK_APP_TOKEN,
});

// Initialize Google Sheets
const doc = new GoogleSpreadsheet(process.env.GOOGLE_SHEET_ID);

// Service account authentication
const serviceAccountAuth = {
    client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
};

// Check if message is an attendance message
function isAttendanceMessage(text) {
    const patterns = [
        /(in|clockin|checkin|arriving|starting|beginning)/i,
        /(out|clockout|checkout|leaving|ending)/i,
        /\d{1,2}:\d{2}\s*(am|pm)?/i,
        /attendance/i
    ];

    return patterns.some(pattern => pattern.test(text));
}

// Parse attendance message
function parseAttendanceMessage(text, userId, timestamp) {
    const now = moment.unix(timestamp);
    const isPM = now.hours() >= 12;
    const timeString = now.format('HH:mm');

    // Check if message contains time pattern
    const timeMatch = text.match(/\b(\d{1,2}:\d{2})\s*(am|pm)?\b/i);
    const extractedTime = timeMatch ? timeMatch[1] : timeString;

    // Determine if it's check-in or check-out based on time and keywords
    const isCheckIn = /(in|clockin|checkin|arriving|starting|beginning)/i.test(text) ||
        (!/(out|clockout|checkout|leaving|ending)/i.test(text) && now.hours() < 21);

    return {
        date: now.format('YYYY-MM-DD'),
        time: extractedTime,
        type: isCheckIn ? 'in' : 'out',
        datetime: now.format(),
        userId: userId
    };
}

// Record attendance in Google Sheets
async function recordAttendance(attendanceData, userInfo) {
    await doc.useServiceAccountAuth(serviceAccountAuth);
    await doc.loadInfo();

    let sheet = doc.sheetsByTitle['Attendance'];
    if (!sheet) {
        sheet = await doc.addSheet({
            title: 'Attendance',
            headerValues: ['Date', 'User', 'Time', 'Type', 'Datetime', 'User ID']
        });
    }

    await sheet.addRow({
        'Date': attendanceData.date,
        'User': userInfo.real_name || userInfo.name,
        'Time': attendanceData.time,
        'Type': attendanceData.type,
        'Datetime': attendanceData.datetime,
        'User ID': attendanceData.userId
    });

    console.log(`Attendance recorded: ${attendanceData.type} for ${userInfo.real_name} at ${attendanceData.time}`);
}

// Listen for messages in the attendance channel
app.message(async ({ message, say, client }) => {
    try {
        // Check if message is in the attendance channel
        if (message.channel !== process.env.ATTENDANCE_CHANNEL_ID) return;

        // Check if message is an attendance message
        if (!isAttendanceMessage(message.text)) return;

        // Get user info
        const userInfo = await client.users.info({
            user: message.user
        });

        // Parse the attendance message
        const attendanceData = parseAttendanceMessage(message.text, message.user, message.ts);

        // Record attendance in Google Sheets
        await recordAttendance(attendanceData, userInfo.user);

        // Send confirmation
        await say({
            thread_ts: message.ts,
            text: `Attendance recorded: ${attendanceData.type.toUpperCase()} at ${attendanceData.time}`
        });

    } catch (error) {
        console.error('Error processing message:', error);
    }
});

// Start the app
(async () => {
    await app.start(process.env.PORT || 3000);
    console.log('⚡️ Attendance bot is running!');
})();