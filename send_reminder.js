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

// ── 오늘 날짜 계산 (KST) ──
function getTodayKST() {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
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

// ── 날짜 차이 계산 (일수) ──
function dateDiffDays(dateStr1, dateStr2) {
  const d1 = new Date(dateStr1 + 'T00:00:00+09:00');
  const d2 = new Date(dateStr2 + 'T00:00:00+09:00');
  return Math.round((d1 - d2) / (1000 * 60 * 60 * 24));
}

// ── Firestore REST API로 내일 상담 조회 ──
async function getTomorrowConsultations(tomorrow, today) {
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
              const createdAt = f.createdAt?.stringValue || '';
              const createdDate = createdAt ? createdAt.slice(0, 10) : today;
              return {
                id: doc.name.split('/').pop(),
                studentName: f.studentName?.stringValue || '',
                parentName: f.parentName?.stringValue || '',
                phone: f.phone?.stringValue || '',
                date: f.date?.stringValue || '',
                time: f.time?.stringValue || '',
                grade: f.grade?.stringValue || '',
                createdDate,
              };
            })
            .filter(c => {
              if (c.date !== tomorrow) return false;
              if (!c.phone) return false;
              // 상담일 - 등록일 >= 2일인 경우만 발송
              const diff = dateDiffDays(c.date, c.createdDate);
              if (diff < 2) {
                console.log(`⏭️ 스킵 [${c.studentName}]: 등록일(${c.createdDate})과 상담일(${c.date}) 차이 ${diff}일 (2일 미만)`);
                return false;
              }
              return true;
            });
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
        channelId: 'KA01PF2606231202555462JuD045iZxE',
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
  const today = getTodayKST();
  console.log(`📅 오늘 (KST): ${today}`);
  console.log(`📅 내일 (KST): ${tomorrow}`);

  const consultations = await getTomorrowConsultations(tomorrow, today);
  console.log(`📋 발송 대상 건수: ${consultations.length}건`);

  if (consultations.length === 0) {
    console.log('발송할 상담이 없습니다.');
    return;
  }

  for (const c of consultations) {
    console.log(`발송 중: ${c.studentName} (${c.phone}) - ${c.time}`);
    await sendAlimtalk(c);
    await new Promise(r => setTimeout(r, 1000));
  }

  console.log('✅ 모든 알림톡 발송 완료!');
}

main().catch(e => {
  console.error('오류 발생:', e);
  process.exit(1);
});
