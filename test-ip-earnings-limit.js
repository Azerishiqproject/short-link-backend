const axios = require('axios');

const BASE_URL = 'http://localhost:3001'; // Backend URL'inizi buraya yazın

async function testIPEarningsLimit() {
  console.log('🧪 IP Earnings Limit Test Başlatılıyor...\n');

  try {
    // Test için iki farklı link ID'si kullanın (gerçek link ID'leri ile değiştirin)
    const testLinkId1 = '507f1f77bcf86cd799439011'; // İlk link
    const testLinkId2 = '507f1f77bcf86cd799439012'; // İkinci link
    const testIP = '192.168.1.100';
    
    console.log('📝 Test Link 1 ID:', testLinkId1);
    console.log('📝 Test Link 2 ID:', testLinkId2);
    console.log('🌐 Test IP:', testIP);
    console.log('⏰ Test süresi: 1 saat içinde aynı IP\'den farklı linklere tıklama\n');

    // İlk linke tıklama - ödeme almalı
    console.log('1️⃣ İlk linke tıklama gönderiliyor...');
    const firstClick = await axios.post(`${BASE_URL}/api/links/${testLinkId1}/click`, {}, {
      headers: {
        'X-Forwarded-For': testIP,
        'User-Agent': 'Mozilla/5.0 (Test Browser)'
      }
    });
    
    console.log('✅ İlk link tıklama sonucu:');
    console.log('   - OK:', firstClick.data.ok);
    console.log('   - Duplicate:', firstClick.data.duplicate);
    console.log('   - IP Earned Recently:', firstClick.data.ipEarnedRecently);
    console.log('   - Earnings:', firstClick.data.earnings);
    console.log('');

    // İkinci linke tıklama - ödeme almamalı (aynı IP)
    console.log('2️⃣ İkinci linke tıklama gönderiliyor (aynı IP)...');
    const secondClick = await axios.post(`${BASE_URL}/api/links/${testLinkId2}/click`, {}, {
      headers: {
        'X-Forwarded-For': testIP,
        'User-Agent': 'Mozilla/5.0 (Test Browser)'
      }
    });
    
    console.log('✅ İkinci link tıklama sonucu:');
    console.log('   - OK:', secondClick.data.ok);
    console.log('   - Duplicate:', secondClick.data.duplicate);
    console.log('   - IP Earned Recently:', secondClick.data.ipEarnedRecently);
    console.log('   - Earnings:', secondClick.data.earnings);
    console.log('');

    // Farklı IP'den tıklama - ödeme almalı
    console.log('3️⃣ Farklı IP\'den tıklama gönderiliyor...');
    const thirdClick = await axios.post(`${BASE_URL}/api/links/${testLinkId2}/click`, {}, {
      headers: {
        'X-Forwarded-For': '192.168.1.200',
        'User-Agent': 'Mozilla/5.0 (Test Browser)'
      }
    });
    
    console.log('✅ Farklı IP tıklama sonucu:');
    console.log('   - OK:', thirdClick.data.ok);
    console.log('   - Duplicate:', thirdClick.data.duplicate);
    console.log('   - IP Earned Recently:', thirdClick.data.ipEarnedRecently);
    console.log('   - Earnings:', thirdClick.data.earnings);
    console.log('');

    // Test sonuçları
    console.log('📊 Test Sonuçları:');
    console.log('   - İlk link (aynı IP):', firstClick.data.ipEarnedRecently ? '❌ IP kısıtlaması' : '✅ Normal');
    console.log('   - İkinci link (aynı IP):', secondClick.data.ipEarnedRecently ? '✅ IP kısıtlaması tespit edildi' : '❌ IP kısıtlaması tespit edilmedi');
    console.log('   - Üçüncü link (farklı IP):', thirdClick.data.ipEarnedRecently ? '❌ IP kısıtlaması' : '✅ Normal');
    
    const testPassed = firstClick.data.ipEarnedRecently === false && 
                      secondClick.data.ipEarnedRecently === true && 
                      thirdClick.data.ipEarnedRecently === false;
    
    console.log('\n🎯 Test Durumu:', testPassed ? '✅ BAŞARILI' : '❌ BAŞARISIZ');

  } catch (error) {
    console.error('❌ Test hatası:', error.response?.data || error.message);
  }
}

// Test'i çalıştır
testIPEarningsLimit();
