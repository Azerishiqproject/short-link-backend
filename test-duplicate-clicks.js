const axios = require('axios');

const BASE_URL = 'http://localhost:3001'; // Backend URL'inizi buraya yazın

async function testDuplicateClickProtection() {
  console.log('🧪 Duplicate Click Protection Test Başlatılıyor...\n');

  try {
    // Test için önce bir link oluşturalım (gerçek bir link ID'si kullanın)
    const testLinkId = '507f1f77bcf86cd799439011'; // Gerçek bir link ID'si ile değiştirin
    
    console.log('📝 Test Link ID:', testLinkId);
    console.log('🌐 Test IP: 192.168.1.100');
    console.log('⏰ Test süresi: 1 saat içinde aynı IP\'den aynı linke 2 tıklama\n');

    // İlk tıklama - ödeme almalı
    console.log('1️⃣ İlk tıklama gönderiliyor...');
    const firstClick = await axios.post(`${BASE_URL}/api/links/${testLinkId}/click`, {}, {
      headers: {
        'X-Forwarded-For': '192.168.1.100',
        'User-Agent': 'Mozilla/5.0 (Test Browser)'
      }
    });
    
    console.log('✅ İlk tıklama sonucu:');
    console.log('   - OK:', firstClick.data.ok);
    console.log('   - Duplicate:', firstClick.data.duplicate);
    console.log('   - Earnings:', firstClick.data.earnings);
    console.log('');

    // İkinci tıklama - ödeme almamalı ama click sayısı artmalı
    console.log('2️⃣ İkinci tıklama gönderiliyor (1 saat içinde aynı IP)...');
    const secondClick = await axios.post(`${BASE_URL}/api/links/${testLinkId}/click`, {}, {
      headers: {
        'X-Forwarded-For': '192.168.1.100',
        'User-Agent': 'Mozilla/5.0 (Test Browser)'
      }
    });
    
    console.log('✅ İkinci tıklama sonucu:');
    console.log('   - OK:', secondClick.data.ok);
    console.log('   - Duplicate:', secondClick.data.duplicate);
    console.log('   - Earnings:', secondClick.data.earnings);
    console.log('');

    // Farklı IP'den tıklama - ödeme almalı
    console.log('3️⃣ Farklı IP\'den tıklama gönderiliyor...');
    const thirdClick = await axios.post(`${BASE_URL}/api/links/${testLinkId}/click`, {}, {
      headers: {
        'X-Forwarded-For': '192.168.1.200',
        'User-Agent': 'Mozilla/5.0 (Test Browser)'
      }
    });
    
    console.log('✅ Farklı IP tıklama sonucu:');
    console.log('   - OK:', thirdClick.data.ok);
    console.log('   - Duplicate:', thirdClick.data.duplicate);
    console.log('   - Earnings:', thirdClick.data.earnings);
    console.log('');

    // Test sonuçları
    console.log('📊 Test Sonuçları:');
    console.log('   - İlk tıklama (aynı IP):', firstClick.data.duplicate ? '❌ Duplicate' : '✅ Normal');
    console.log('   - İkinci tıklama (aynı IP):', secondClick.data.duplicate ? '✅ Duplicate tespit edildi' : '❌ Duplicate tespit edilmedi');
    console.log('   - Üçüncü tıklama (farklı IP):', thirdClick.data.duplicate ? '❌ Duplicate' : '✅ Normal');
    
    const testPassed = firstClick.data.duplicate === false && 
                      secondClick.data.duplicate === true && 
                      thirdClick.data.duplicate === false;
    
    console.log('\n🎯 Test Durumu:', testPassed ? '✅ BAŞARILI' : '❌ BAŞARISIZ');

  } catch (error) {
    console.error('❌ Test hatası:', error.response?.data || error.message);
  }
}

// Test'i çalıştır
testDuplicateClickProtection();
