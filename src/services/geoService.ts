import geoip from 'geoip-lite';

// Fallback country mapping for private IPs and test ranges
const fallbackCountryMap: { [key: string]: string } = {
  // Private IP ranges
  "127.0.0.1": "Local",
  "192.168.": "Private", 
  "10.0.": "Private",
  "172.16.": "Private",
  "172.17.": "Private",
  "172.18.": "Private",
  "172.19.": "Private",
  "172.20.": "Private",
  "172.21.": "Private",
  "172.22.": "Private",
  "172.23.": "Private",
  "172.24.": "Private",
  "172.25.": "Private",
  "172.26.": "Private",
  "172.27.": "Private",
  "172.28.": "Private",
  "172.29.": "Private",
  "172.30.": "Private",
  "172.31.": "Private",
  // Test IP ranges
  "192.0.2.": "Test", // Test IP range
};

export function getCountryFromIP(ip: string): string {
  // Remove IPv6 prefix if present
  const cleanIP = ip === '::1' ? '127.0.0.1' : ip.replace(/^::ffff:/, '');
  
  // Check if it's a private/test IP first
  for (const [prefix, country] of Object.entries(fallbackCountryMap)) {
    if (cleanIP.startsWith(prefix)) {
      return country;
    }
  }
  
  // Use geoip-lite for real IP addresses
  try {
    const geo = geoip.lookup(cleanIP);
    if (geo && geo.country) {
      return geo.country;
    }
  } catch (error) {
    console.error('GeoIP lookup error:', error);
  }
  
  // Fallback if no country found
  return "Unknown";
}

export function getClientIP(req: any): string {
  // Debug modu (sadece development'ta)
  const isDebug = process.env.NODE_ENV === 'development' || process.env.DEBUG_IP === 'true';
  
  if (isDebug) {
    // Debug: Tüm IP kaynaklarını logla
    const debugInfo = {
      'x-forwarded-for': req.headers['x-forwarded-for'],
      'x-real-ip': req.headers['x-real-ip'],
      'x-client-ip': req.headers['x-client-ip'],
      'x-cluster-client-ip': req.headers['x-cluster-client-ip'],
      'cf-connecting-ip': req.headers['cf-connecting-ip'], // Cloudflare
      'true-client-ip': req.headers['true-client-ip'], // Akamai
      'req.ip': req.ip,
      'req.socket.remoteAddress': req.socket?.remoteAddress,
      'req.connection.remoteAddress': req.connection?.remoteAddress,
    };
    
    console.log('IP Debug Info:', debugInfo);
  }
  
  // Öncelik sırasına göre IP kaynaklarını kontrol et
  const ipSources = [
    req.headers['cf-connecting-ip'], // Cloudflare
    req.headers['true-client-ip'], // Akamai
    req.headers['x-client-ip'],
    req.headers['x-cluster-client-ip'],
    req.headers['x-real-ip'],
    req.headers['x-forwarded-for']?.split(',')[0]?.trim(),
    req.ip,
    req.socket?.remoteAddress,
    req.connection?.remoteAddress,
  ];
  
  // İlk geçerli IP'yi bul
  let raw = '';
  for (const source of ipSources) {
    if (source && typeof source === 'string' && source.trim()) {
      raw = source.trim();
      break;
    }
  }
  
  if (isDebug) {
    console.log('Selected IP source:', raw);
  }
  
  // IP bulunamadıysa fallback
  if (!raw) {
    if (isDebug) {
      console.log('No IP found, using fallback 127.0.0.1');
    }
    return '127.0.0.1';
  }
  
  // IPv6 localhost'u IPv4'e çevir
  if (raw === '::1') {
    if (isDebug) {
      console.log('IPv6 localhost detected, converting to 127.0.0.1');
    }
    return '127.0.0.1';
  }
  
  // IPv6 mapped IPv4 adreslerini temizle
  const cleanedIP = raw.replace(/^::ffff:/, '');
  
  if (isDebug) {
    console.log('Final IP:', cleanedIP);
  }
  
  return cleanedIP;
}

