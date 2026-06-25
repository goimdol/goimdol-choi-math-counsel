const https = require('https');
const crypto = require('crypto');
const TEMPLATE_ID = process.env.SOLAPI_TEMPLATE_INSTANT;
const SOLAPI_API_KEY = process.env.SOLAPI_API_KEY;
const SOLAPI_API_SECRET = process.env.SOLAPI_API_SECRET;
const TEMPLATE_INSTANT = process.env.SOLAPI_TEMPLATE_INSTANT;
const TEMPLATE_REMINDER = process.env.SOLAPI_TEMPLATE_REMINDER;

function getSolapiAuthHeader() {
  const date = new Date().toISOString();
  const salt = crypto.randomBytes(16).toString('hex');
  const hmac = crypto.createHmac('sha256', SOLAPI_API_SECRET);
  hmac.update(date + salt);
  const signature = hmac.digest('hex');
  return `HMAC-SHA256 apiKey=${SOLAPI_API_KEY}, date=${date}, salt=${salt}, signature=${signature}`;
}

function formatDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00+09:00');
  const dows = ['일', '월', '화', '수', '목', '금', '토'];
  return `${d.getMonth() + 1}월 ${d.getDate()}일 (${dows[d.getDay()]})`;
}

async function sendAlimtalk(phone, dateStr, time, templateId) {
  const body = JSON.stringify({
    message: {
      to: phone.replace(/-/g, ''),
      from: '01051476394',
      kakaoOptions: {
        pfId: 'KA01PF2606231202555462JuD045iZxE',
        templateId: templateId,
        variables: {
          '#{날짜}': formatDate(dateStr),
          '#{시간}': time,
        },
        disableSms: false,
      }
    }
  });

  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.solapi.com',
      path: '/messages/v4/send',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': getSolapiAuthHeader(),
        'Content-Length': Buffer.byteLength(body),
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(JSON.parse(data)));
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

exports.handler = async (event) => {
  // CORS 허용
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const { phone, date, time, type } = JSON.parse(event.body);

    if (!phone || !date || !time) {
      return {
        statusCode: 400, headers,
        body: JSON.stringify({ error: '필수 파라미터 누락 (phone, date, time)' })
      };
    }

    const templateId = type === 'reminder' ? TEMPLATE_REMINDER : TEMPLATE_INSTANT;
    const result = await sendAlimtalk(phone, date, time, templateId);

    return {
      statusCode: 200, headers,
      body: JSON.stringify({ success: true, result })
    };
  } catch (e) {
    return {
      statusCode: 500, headers,
      body: JSON.stringify({ error: e.message })
    };
  }
};
