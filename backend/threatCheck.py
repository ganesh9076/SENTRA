"""
THREAT ROUTER
-------------
Owner  : Team Member 2
Prefix : /api/threat
Endpoints:
  POST /api/threat/check  → analyze IP / domain / hash
"""

from fastapi import APIRouter
from datetime import datetime
import socket, subprocess, os, re, requests, time

router = APIRouter()


# ── Execution helpers ─────────────────────────────────

def execute_nslookup(domain: str) -> dict:
    try:
        result = subprocess.run(['nslookup', domain], capture_output=True, text=True, timeout=5)
        ips = [ip for ip in re.findall(r'Address:\s+(\d+\.\d+\.\d+\.\d+)', result.stdout)
               if not ip.endswith('.1') or result.stdout.count('Address') > 2]
        if not ips:
            ips = list(set(r[4][0] for r in socket.getaddrinfo(domain, None)))
        return {'resolved': len(ips) > 0, 'ips': ips[:5], 'raw': result.stdout[:300]}
    except Exception as e:
        try:
            ips = list(set(r[4][0] for r in socket.getaddrinfo(domain, None)))
            return {'resolved': True, 'ips': ips[:5], 'raw': 'socket fallback'}
        except:
            return {'resolved': False, 'ips': [], 'error': str(e)}


def execute_whois(ip: str) -> dict:
    try:
        result = subprocess.run(['whois', ip], capture_output=True, text=True, timeout=10)
        output = result.stdout
        country = re.search(r'[Cc]ountry:\s*(\w{2})', output)
        org     = re.search(r'[Oo]rg(?:anization)?[Nn]ame?:\s*(.+)', output)
        asn     = re.search(r'(?:OriginAS|[Aa]utonomous[Ss]ystem).*?:\s*(AS\d+)', output)
        if country or org or asn:
            return {
                'country':      country.group(1).upper() if country else '??',
                'organization': org.group(1).strip()     if org     else 'Unknown',
                'asn':          asn.group(1)              if asn     else '—',
                'last_seen':    'today', 'source': 'whois-cli'
            }
    except FileNotFoundError:
        pass
    except Exception:
        pass
    try:
        r = requests.get(
            f'http://ip-api.com/json/{ip}?fields=country,countryCode,org,as,proxy,hosting,isp',
            timeout=5
        ).json()
        return {
            'country':      r.get('countryCode', '??'),
            'organization': r.get('org') or r.get('isp', 'Unknown'),
            'asn':          r.get('as', '—'),
            'proxy':        r.get('proxy', False),
            'hosting':      r.get('hosting', False),
            'last_seen':    'today', 'source': 'ip-api'
        }
    except Exception as e:
        return {'country': '??', 'organization': f'Lookup failed: {str(e)[:50]}', 'asn': '—'}


def execute_ping(ip: str) -> dict:
    try:
        param  = '-n' if os.name == 'nt' else '-c'
        result = subprocess.run(['ping', param, '1', '-W', '2', ip],
                                capture_output=True, text=True, timeout=6)
        alive   = result.returncode == 0
        time_ms = re.search(r'time[<=](\d+\.?\d*)ms', result.stdout)
        return {
            'alive':         alive,
            'response_time': (time_ms.group(1) + 'ms') if time_ms else ('—' if not alive else '<1ms'),
            'reachable':     alive
        }
    except Exception:
        return {'alive': False, 'response_time': '—', 'reachable': False}


def check_urlhaus(indicator: str) -> dict:
    try:
        r = requests.post('https://urlhaus-api.abuse.ch/v1/host/',
                          data={'host': indicator}, timeout=6).json()
        listed = r.get('query_status') == 'is_listed'
        urls   = r.get('urls', [])
        return {'listed': listed, 'threat': urls[0].get('threat', 'malware') if urls else 'unknown',
                'count': len(urls), 'source': 'URLhaus'}
    except Exception as e:
        return {'listed': False, 'error': str(e)}


def check_malwarebazaar(hash_value: str) -> dict:
    try:
        r = requests.post('https://mb-api.abuse.ch/api/v1/',
                          data={'query': 'get_info', 'hash': hash_value}, timeout=6).json()
        if r.get('query_status') == 'hash_not_found':
            return {'found': False, 'source': 'MalwareBazaar'}
        info = r.get('data', [{}])[0]
        return {
            'found':      True,
            'malware':    info.get('signature', 'Unknown'),
            'file_type':  info.get('file_type', '?'),
            'tags':       info.get('tags', []),
            'first_seen': info.get('first_seen', '—'),
            'last_seen':  info.get('last_seen',  '—'),
            'source':     'MalwareBazaar'
        }
    except Exception as e:
        return {'found': False, 'error': str(e)}


def analyze_ip_reputation(ip: str, whois_data: dict = None) -> dict:
    score, reasons = 30, []
    for pattern, desc in [
        (r'^10\.', 'Private RFC1918 (10.x.x.x)'),
        (r'^172\.(1[6-9]|2[0-9]|3[01])\.', 'Private RFC1918 (172.16-31.x.x)'),
        (r'^192\.168\.', 'Private RFC1918 (192.168.x.x)'),
        (r'^127\.', 'Loopback address'),
        (r'^169\.254\.', 'Link-local address'),
        (r'^0\.', 'Invalid/Reserved'),
    ]:
        if re.match(pattern, ip):
            return {'score': 5, 'reasons': [f'{desc} — internal, safe'], 'type': 'internal'}

    urlhaus = check_urlhaus(ip)
    if urlhaus.get('listed'):
        score += 55
        reasons.append(f"URLhaus: active {urlhaus.get('threat','malware')} host ({urlhaus.get('count',0)} URLs)")

    if whois_data:
        if whois_data.get('proxy'):
            score += 20; reasons.append('Proxy/VPN detected')
        if whois_data.get('hosting'):
            score += 15; reasons.append('Hosting/datacenter IP')

    known_bad_asns = ['AS60068', 'AS208091', 'AS396356', 'AS174', 'AS3223']
    if whois_data and any(bad in whois_data.get('asn', '') for bad in known_bad_asns):
        score += 25; reasons.append(f"Suspicious ASN: {whois_data.get('asn')}")

    if re.match(r'^185\.220\.|^45\.142\.|^199\.249\.', ip):
        score += 40; reasons.append('Known Tor exit node range')

    if not reasons:
        reasons.append('Public IP — no threat signals found')
    return {'score': min(score, 100), 'reasons': reasons, 'type': 'public'}


def analyze_domain_patterns(domain: str) -> dict:
    score, reasons = 30, []
    for tld in ['.tk', '.ml', '.ga', '.cf', '.xyz', '.top', '.click', '.ru', '.pw']:
        if domain.endswith(tld):
            score += 15; reasons.append(f'Suspicious TLD: {tld}')

    homoglyphs = {'0': 'o', '1': 'l', '3': 'e', '4': 'a', '5': 's'}
    brands     = ['paypal', 'google', 'amazon', 'apple', 'microsoft', 'facebook', 'netflix']
    for digit, letter in homoglyphs.items():
        if digit in domain:
            swapped = domain.replace(digit, letter)
            for brand in brands:
                if brand in swapped and brand not in domain:
                    score += 30; reasons.append(f'Homoglyph attack mimicking "{brand}"')

    for word in ['secure', 'login', 'verify', 'update', 'confirm', 'account', 'banking', 'signin', 'support']:
        if word in domain.lower():
            score += 10; reasons.append(f'Phishing keyword: "{word}"')

    clean = re.sub(r'[\.\-]', '', domain.replace('www', ''))
    if len(clean) > 12 and len(set(clean)) / len(clean) > 0.72:
        score += 20; reasons.append(f'High entropy domain (DGA likelihood)')

    if re.search(r'\d{1,3}-\d{1,3}-\d{1,3}-\d{1,3}', domain):
        score += 20; reasons.append('IP address embedded in domain name')

    if domain.count('.') >= 4:
        score += 10; reasons.append(f'Excessive subdomains ({domain.count(".")} dots)')

    if not reasons:
        reasons.append('No suspicious patterns detected')
    return {'score': min(score, 100), 'reasons': reasons}


# ── Endpoint ──────────────────────────────────────────

@router.post("/check")
def threat_check(data: dict):
    """
    Auto-detect indicator type (IP / domain / URL / MD5 / SHA256) and analyze.
    Body: { "value": "...", "source_node": "NODE-01" }
    """
    value       = data.get('value', '').strip()
    source_node = data.get('source_node', 'UNKNOWN')
    if not value:
        return {'error': 'No indicator provided'}

    result = {'input': value, 'source_node': source_node,
              'timestamp': time.strftime('%Y-%m-%d %H:%M:%S'), 'executions': []}

    # ── IP ────────────────────────────────────────────
    if re.match(r'^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$', value):
        result['type'] = 'ip'
        whois_data = execute_whois(value)
        result['executions'].append({'tool': 'whois/ip-api', 'data': whois_data})
        ping_data  = execute_ping(value)
        result['executions'].append({'tool': 'ping', 'data': ping_data})
        rep_data   = analyze_ip_reputation(value, whois_data)
        result['executions'].append({'tool': 'reputation', 'data': rep_data})
        score = rep_data['score']
        cat   = 'malware' if score > 75 else 'suspicious' if score > 45 else 'safe'
        result['verdict'] = {
            'cat': cat, 'score': score,
            'reason':       ' | '.join(rep_data['reasons'][:3]),
            'source_node':  source_node,
            'country':      whois_data.get('country', '??'),
            'asn':          whois_data.get('asn', '—'),
            'organization': whois_data.get('organization', 'Unknown'),
            'first': '—', 'last': 'today',
            'reachable':    ping_data['reachable']
        }

    # ── DOMAIN / URL ──────────────────────────────────
    elif re.match(r'^(https?://)?[a-zA-Z0-9][-a-zA-Z0-9]*(\.[a-zA-Z]{2,})+', value):
        result['type'] = 'domain'
        domain = re.sub(r'^https?://', '', value).split('/')[0].split('?')[0]
        dns_data     = execute_nslookup(domain)
        result['executions'].append({'tool': 'nslookup', 'data': dns_data})
        pattern_data = analyze_domain_patterns(domain)
        result['executions'].append({'tool': 'pattern_analysis', 'data': pattern_data})
        urlhaus_data = check_urlhaus(domain)
        result['executions'].append({'tool': 'URLhaus', 'data': urlhaus_data})
        score   = pattern_data['score']
        reasons = list(pattern_data['reasons'])
        if urlhaus_data.get('listed'):
            score = min(score + 50, 100)
            reasons.insert(0, f"URLhaus: {urlhaus_data.get('threat','malware')} ({urlhaus_data.get('count',0)} URLs)")
        if dns_data['resolved'] and dns_data['ips']:
            rep = analyze_ip_reputation(dns_data['ips'][0])
            result['executions'].append({'tool': 'resolved_ip_reputation', 'data': rep})
            if rep['score'] > 60:
                score = min(score + 15, 100)
                reasons.append(f"Resolves to flagged IP: {dns_data['ips'][0]}")
        cat = 'malware' if score > 75 else 'phishing' if score > 55 else 'suspicious' if score > 35 else 'safe'
        result['verdict'] = {
            'cat': cat, 'score': score,
            'reason':        ' | '.join(reasons[:3]),
            'source_node':   source_node,
            'country': '??', 'asn': '—', 'organization': '—',
            'first': '—', 'last': 'today',
            'resolved_ips':  dns_data.get('ips', [])
        }

    # ── HASH ──────────────────────────────────────────
    elif re.match(r'^[a-f0-9]{32}$|^[a-f0-9]{64}$', value, re.I):
        result['type'] = 'hash'
        hash_type = 'MD5' if len(value) == 32 else 'SHA256'
        mb_data   = check_malwarebazaar(value.lower())
        result['executions'].append({'tool': 'MalwareBazaar', 'data': mb_data})
        if mb_data.get('found'):
            score  = 95; cat = 'malware'
            reason = f"MalwareBazaar: {mb_data.get('malware','?')} | Type: {mb_data.get('file_type','?')}"
            first, last = mb_data.get('first_seen', '—'), mb_data.get('last_seen', '—')
        else:
            score  = 20; cat = 'unknown'
            reason = f'{hash_type} not found in MalwareBazaar — likely clean or unknown'
            first = last = '—'
        result['verdict'] = {
            'cat': cat, 'score': score, 'reason': reason,
            'source_node': source_node,
            'country': '—', 'asn': '—', 'organization': '—',
            'first': first, 'last': last, 'hash_type': hash_type
        }

    # ── UNKNOWN ───────────────────────────────────────
    else:
        result['type'] = 'unknown'
        result['verdict'] = {
            'cat': 'unknown', 'score': 50,
            'reason': 'Unrecognized format — try IP, domain, URL, MD5 or SHA256',
            'source_node': source_node,
            'country': '??', 'asn': '—', 'organization': '—',
            'first': '—', 'last': '—'
        }

    result.update(result['verdict'])
    return result