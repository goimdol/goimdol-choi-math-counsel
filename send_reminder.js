const https = require('https');
const crypto = require('crypto');

// ── 환경변수 ──
const SOLAPI_API_KEY = process.env.SOLAPI_API_KEY;
const SOLAPI_API_SECRET = process.env.SOLAPI_API_SECRET;
const TEMPLATE_ID = process.env.SOLAPI_TEMPLATE_REMINDER;
const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID;
const FIREBASE_API_KEY = process.env.FIREBASE_API_KEY;

// ── 내일 날짜 계산 (KST) ──
function getTomorrowKST() {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  kst.setDate(kst.getDate() + 1);
  const y = kst.getUTCFullYear();
  const m = String(kst.getUTCMonth() + 1).padStart(2, '0');
  const d = String(kst.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// ── 날짜 포맷 (예: 6월 25일 (수)) ──
function formatDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00+09:00');
  const dows = ['일', '월', '화', '수', '목', '금', '토'];
  return `${d.getMonth() + 1}월 ${d.getDate()}일 (${dows[d.getDay()]})`;
}

// ── Firestore REST API로 내일 상담 조회 ──
async function getTomorrowConsultations(date) {
  const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/consultations?key=${FIREBASE_API_KEY}`;

  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          const docs = json.documents || [];
          const result = docs
            .map(doc => {
              const f = doc.fields || {};
              return {
                id: doc.name.split('/').pop(),
                studentName: f.studentName?.stringValue || '',
                parentName: f.parentName?.stringValue || '',
                phone: f.phone?.stringValue || '',
                date: f.date?.stringValue || '',
                time: f.time?.stringValue || '',
                grade: f.grade?.stringValue || '',
              };
            })
            .filter(c => c.date === date && c.phone);
          resolve(result);
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

// ── Solapi HMAC 인증 헤더 생성 ──
function getSolapiAuthHeader() {
  const date = new Date().toISOString();
  const salt = crypto.randomBytes(16).toString('hex');
  const hmac = crypto.createHmac('sha256', SOLAPI_API_SECRET);
  hmac.update(date + salt);
  const signature = hmac.digest('hex');
  return `HMAC-SHA256 apiKey=${SOLAPI_API_KEY}, date=${date}, salt=${salt}, signature=${signature}`;
}

// ── Solapi 알림톡 발송 ──
async function sendAlimtalk(consultation) {
  const dateStr = formatDate(consultation.date);
  const body = JSON.stringify({
    message: {
      to: consultation.phone.replace(/-/g, ''),
      from: '01051476394',
      kakaoOptions: {
        pfId: '@최선생',
        templateId: TEMPLATE_ID,
        variables: {
          '#{날짜}': dateStr,
          '#{시간}': consultation.time,
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
      res.on('end', () => {
        console.log(`✅ 발송 완료 [${consultation.studentName} ${consultation.phone}]:`, data);
        resolve(data);
      });
    });

    req.on('error', (e) => {
      console.error(`❌ 발송 실패 [${consultation.studentName}]:`, e);
      reject(e);
    });

    req.write(body);
    req.end();
  });
}

// ── 메인 실행 ──
async function main() {
  const tomorrow = getTomorrowKST();
  console.log(`📅 내일 날짜 (KST): ${tomorrow}`);

  const consultations = await getTomorrowConsultations(tomorrow);
  console.log(`📋 내일 상담 건수: ${consultations.length}건`);

  if (consultations.length === 0) {
    console.log('발송할 상담이 없습니다.');
    return;
  }

  for (const c of consultations) {
    console.log(`발송 중: ${c.studentName} (${c.phone}) - ${c.time}`);
    await sendAlimtalk(c);
    // 발송 간격 1초
    await new Promise(r => setTimeout(r, 1000));
  }

  console.log('✅ 모든 알림톡 발송 완료!');
}

main().catch(e => {
  console.error('오류 발생:', e);
  process.exit(1);
});
