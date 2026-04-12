#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════
# PilingTrack — Автоматический тест-скрипт
# Запуск: bash scripts/test-pilingtrack.sh
# ═══════════════════════════════════════════════════════════════════════

set -euo pipefail

BASE="http://localhost:3000"
PASS=0; FAIL=0; WARN=0; TOTAL=0

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

pass() { PASS=$((PASS+1)); TOTAL=$((TOTAL+1)); echo -e "  ${GREEN}✅ PASS${NC} $1"; }
fail() { FAIL=$((FAIL+1)); TOTAL=$((TOTAL+1)); echo -e "  ${RED}❌ FAIL${NC} $1 — $2"; }
warn() { WARN=$((WARN+1)); TOTAL=$((TOTAL+1)); echo -e "  ${YELLOW}⚠️  WARN${NC} $1 — $2"; }

HTTP() { curl -s -o /dev/null -w "%{http_code}" "$@" 2>/dev/null; }
JSON() { curl -s "$@" 2>/dev/null; }

echo ""
echo -e "${BOLD}════════════════════════════════════════════════${NC}"
echo -e "${BOLD}  PilingTrack — Автоматическое тестирование${NC}"
echo -e "${BOLD}  $(date '+%Y-%m-%d %H:%M:%S')${NC}"
echo -e "${BOLD}════════════════════════════════════════════════${NC}"
echo ""

# ═══════════ HEALTH CHECK ═══════════
echo -e "${CYAN}${BOLD}[1/9] Health Check${NC}"
CODE=$(HTTP "$BASE/")
[ "$CODE" = "200" ] && pass "GET / → 200" || fail "GET /" "got $CODE"
CODE=$(HTTP "$BASE/api/auth/pin" -X POST -H 'Content-Type: application/json' -d '{}')
[ "$CODE" = "400" ] && pass "POST /api/auth/pin empty → 400" || fail "POST /api/auth/pin empty" "got $CODE"

# ═══════════ AUTH ═══════════
echo ""
echo -e "${CYAN}${BOLD}[2/9] Аутентификация${NC}"

ADMIN_RESP=$(JSON "$BASE/api/auth/pin" -X POST -H 'Content-Type: application/json' -d '{"pin":"1234"}')
ADMIN_ID=$(echo "$ADMIN_RESP" | python3 -c "import sys,json;d=json.load(sys.stdin).get('user',{});print(d.get('id','FAIL'))" 2>/dev/null || echo "FAIL")
[ "$ADMIN_ID" != "FAIL" ] && pass "Admin login PIN=1234 → id=$ADMIN_ID" || fail "Admin login" "$ADMIN_RESP"

OP1_RESP=$(JSON "$BASE/api/auth/pin" -X POST -H 'Content-Type: application/json' -d '{"pin":"0000"}')
OP1_ID=$(echo "$OP1_RESP" | python3 -c "import sys,json;d=json.load(sys.stdin).get('user',{});print(d.get('id','FAIL'))" 2>/dev/null || echo "FAIL")
[ "$OP1_ID" != "FAIL" ] && pass "Operator1 login PIN=0000 → id=$OP1_ID" || fail "Operator1 login" "$OP1_RESP"

OP2_RESP=$(JSON "$BASE/api/auth/pin" -X POST -H 'Content-Type: application/json' -d '{"pin":"1111"}')
OP2_ID=$(echo "$OP2_RESP" | python3 -c "import sys,json;d=json.load(sys.stdin).get('user',{});print(d.get('id','FAIL'))" 2>/dev/null || echo "FAIL")
[ "$OP2_ID" != "FAIL" ] && pass "Operator2 login PIN=1111 → id=$OP2_ID" || fail "Operator2 login" "$OP2_RESP"

CODE=$(HTTP "$BASE/api/auth/pin" -X POST -H 'Content-Type: application/json' -d '{"pin":"9999"}')
[ "$CODE" = "401" ] && pass "Wrong PIN=9999 → 401" || fail "Wrong PIN" "got $CODE"

# ═══════════ API PROTECTION ═══════════
echo ""
echo -e "${CYAN}${BOLD}[3/9] Защита API (без токена → 401)${NC}"

for EP in "equipment/all" "sites/all" "reports/all" "crews/all" "users" "analytics/sites" "dictionary/all" "telegram/configs"; do
  CODE=$(HTTP "$BASE/api/$EP")
  [ "$CODE" = "401" ] && pass "GET /api/$EP → 401" || fail "GET /api/$EP" "got $CODE"
done

# ═══════════ RBAC ═══════════
echo ""
echo -e "${CYAN}${BOLD}[4/9] Разделение ролей (оператор → 403 на admin)${NC}"

for EP in "users" "analytics/sites" "crews/all"; do
  CODE=$(HTTP "$BASE/api/$EP" -H "Authorization: Bearer $OP1_ID")
  [ "$CODE" = "403" ] && pass "Operator GET /api/$EP → 403" || fail "Operator GET /api/$EP" "got $CODE"
done

CODE=$(HTTP "$BASE/api/users" -H "Authorization: Bearer $ADMIN_ID")
[ "$CODE" = "200" ] && pass "Admin GET /api/users → 200" || fail "Admin GET /api/users" "got $CODE"

# ═══════════ EQUIPMENT ═══════════
echo ""
echo -e "${CYAN}${BOLD}[5/9] Оборудование CRUD${NC}"

EQ_LIST=$(JSON "$BASE/api/equipment/all" -H "Authorization: Bearer $ADMIN_ID")
EQ_COUNT=$(echo "$EQ_LIST" | python3 -c "import sys,json;print(len(json.load(sys.stdin).get('equipment',[])))" 2>/dev/null || echo "0")
[ "$EQ_COUNT" -ge 1 ] && pass "GET equipment → $EQ_COUNT items" || fail "GET equipment" "got $EQ_COUNT"

CREATE_RESP=$(JSON "$BASE/api/equipment/manage" -X POST -H 'Content-Type: application/json' -H "Authorization: Bearer $ADMIN_ID" \
  -d '{"name":"TestUnit","model":"T-100","qty":1,"description":"Тестовая единица"}')
NEW_EQ_ID=$(echo "$CREATE_RESP" | python3 -c "import sys,json;print(json.load(sys.stdin).get('equipment',{}).get('id','FAIL'))" 2>/dev/null || echo "FAIL")
[ "$NEW_EQ_ID" != "FAIL" ] && pass "CREATE equipment → id=$NEW_EQ_ID" || fail "CREATE equipment" "$CREATE_RESP"

CODE=$(HTTP "$BASE/api/equipment/manage" -X PUT -H 'Content-Type: application/json' -H "Authorization: Bearer $ADMIN_ID" \
  -d "{\"id\":\"$NEW_EQ_ID\",\"name\":\"TestUnit-Updated\"}")
[ "$CODE" = "200" ] && pass "UPDATE equipment → 200" || fail "UPDATE equipment" "got $CODE"

CODE=$(HTTP "$BASE/api/equipment/manage" -X DELETE -H 'Content-Type: application/json' -H "Authorization: Bearer $ADMIN_ID" \
  -d "{\"id\":\"$NEW_EQ_ID\"}")
[ "$CODE" = "200" ] && pass "DELETE equipment → 200" || fail "DELETE equipment" "got $CODE"

# ═══════════ SITES ═══════════
echo ""
echo -e "${CYAN}${BOLD}[6/9] Объекты${NC}"

SITES_RESP=$(JSON "$BASE/api/sites/all" -H "Authorization: Bearer $ADMIN_ID")
SITE_COUNT=$(echo "$SITES_RESP" | python3 -c "import sys,json;print(len(json.load(sys.stdin).get('sites',[])))" 2>/dev/null || echo "0")
[ "$SITE_COUNT" -ge 1 ] && pass "GET sites → $SITE_COUNT items" || fail "GET sites" "got $SITE_COUNT"

SITE_ID=$(echo "$SITES_RESP" | python3 -c "import sys,json;s=json.load(sys.stdin).get('sites',[]);print(s[0]['id'] if s else 'NONE')" 2>/dev/null)

if [ "$SITE_ID" != "NONE" ]; then
  CODE=$(HTTP "$BASE/api/sites/$SITE_ID" -H "Authorization: Bearer $ADMIN_ID")
  [ "$CODE" = "200" ] && pass "GET site hierarchy → 200" || fail "GET site hierarchy" "got $CODE"
fi

# ═══════════ CREWS ═══════════
echo ""
echo -e "${CYAN}${BOLD}[7/9] Экипажи${NC}"

CREWS_RESP=$(JSON "$BASE/api/crews/all" -H "Authorization: Bearer $ADMIN_ID")
CREW_COUNT=$(echo "$CREWS_RESP" | python3 -c "import sys,json;print(len(json.load(sys.stdin).get('crews',[])))" 2>/dev/null || echo "0")
[ "$CREW_COUNT" -ge 1 ] && pass "GET crews → $CREW_COUNT items" || fail "GET crews" "got $CREW_COUNT"

CREW_RESP=$(JSON "$BASE/api/crews/my?operatorId=$OP1_ID" -H "Authorization: Bearer $OP1_ID")
CREW_NAME=$(echo "$CREW_RESP" | python3 -c "import sys,json;c=json.load(sys.stdin).get('crew',{});print(c.get('name','NONE'))" 2>/dev/null)
[ "$CREW_NAME" != "NONE" ] && pass "GET my crew → $CREW_NAME" || fail "GET my crew" "no crew found"

# ═══════════ REPORTS ═══════════
echo ""
echo -e "${CYAN}${BOLD}[8/9] Отчёты${NC}"

CREW_ID=$(echo "$CREW_RESP" | python3 -c "import sys,json;c=json.load(sys.stdin).get('crew',{});print(c.get('id','NONE'))" 2>/dev/null)
CREW_SITE=$(echo "$CREW_RESP" | python3 -c "import sys,json;c=json.load(sys.stdin).get('crew',{});print(c.get('siteId','NONE'))" 2>/dev/null)
TODAY=$(date +%Y-%m-%d)
REPORT_ID="test-$(date +%s)"

if [ "$CREW_ID" != "NONE" ] && [ "$CREW_SITE" != "NONE" ]; then
  RPT_RESP=$(JSON "$BASE/api/reports/upsert" -X POST -H 'Content-Type: application/json' -H "Authorization: Bearer $OP1_ID" \
    -d "{\"reportId\":\"$REPORT_ID\",\"userId\":\"$OP1_ID\",\"crewId\":\"$CREW_ID\",\"siteId\":\"$CREW_SITE\",\"date\":\"$TODAY\",\"shiftType\":\"DAY\",\"shiftStart\":\"08:00\",\"shiftEnd\":\"18:00\",\"piles\":[{\"pileGradeId\":\"pg-СВ 120-35\",\"count\":10}],\"drillings\":[],\"downtimes\":[]}")
  RPT_ID=$(echo "$RPT_RESP" | python3 -c "import sys,json;print(json.load(sys.stdin).get('report',{}).get('id','FAIL'))" 2>/dev/null || echo "FAIL")
  [ "$RPT_ID" != "FAIL" ] && pass "CREATE report → id=$RPT_ID" || fail "CREATE report" "$RPT_RESP"

  # Overwrite
  RPT_RESP2=$(JSON "$BASE/api/reports/upsert" -X POST -H 'Content-Type: application/json' -H "Authorization: Bearer $OP1_ID" \
    -d "{\"reportId\":\"$REPORT_ID\",\"userId\":\"$OP1_ID\",\"crewId\":\"$CREW_ID\",\"siteId\":\"$CREW_SITE\",\"date\":\"$TODAY\",\"shiftType\":\"DAY\",\"shiftStart\":\"08:00\",\"shiftEnd\":\"18:00\",\"piles\":[{\"pileGradeId\":\"pg-СВ 120-35\",\"count\":12}],\"drillings\":[],\"downtimes\":[]}")
  OVER_PILES=$(echo "$RPT_RESP2" | python3 -c "import sys,json;p=json.load(sys.stdin).get('report',{}).get('piles',[]);print(sum(x.get('count',0) for x in p))" 2>/dev/null || echo "0")
  [ "$OVER_PILES" = "12" ] && pass "OVERWRITE report → 12 piles" || fail "OVERWRITE report" "got $OVER_PILES piles"

  # PDF
  if [ "$RPT_ID" != "FAIL" ]; then
    PDF_CODE=$(HTTP "$BASE/api/reports/pdf?reportId=$RPT_ID" -H "Authorization: Bearer $ADMIN_ID")
    [ "$PDF_CODE" = "200" ] && pass "GET PDF report → 200" || fail "GET PDF report" "got $PDF_CODE"
  fi
else
  warn "SKIP reports" "no crew assigned"
fi

# Reports list + pagination
RL_RESP=$(JSON "$BASE/api/reports/all?page=1" -H "Authorization: Bearer $ADMIN_ID")
RL_TOTAL=$(echo "$RL_RESP" | python3 -c "import sys,json;p=json.load(sys.stdin).get('pagination',{});print(p.get('total','?'))" 2>/dev/null || echo "?")
[ "$RL_TOTAL" != "?" ] && pass "GET reports pagination → total=$RL_TOTAL" || fail "GET reports pagination" "no pagination"

# CSV
CSV_CONTENT=$(JSON "$BASE/api/reports/export" -H "Authorization: Bearer $ADMIN_ID" | head -c 200)
echo "$CSV_CONTENT" | grep -q "Дата" && pass "GET CSV export → valid" || warn "GET CSV export" "unexpected format"

# ═══════════ DICTIONARIES ═══════════
echo ""
echo -e "${CYAN}${BOLD}[9/9] Справочники${NC}"

DICT_RESP=$(JSON "$BASE/api/dictionary/all" -H "Authorization: Bearer $ADMIN_ID")
PG=$(echo "$DICT_RESP" | python3 -c "import sys,json;print(len(json.load(sys.stdin).get('pileGrades',[])))" 2>/dev/null || echo "0")
DT=$(echo "$DICT_RESP" | python3 -c "import sys,json;print(len(json.load(sys.stdin).get('drillingTypes',[])))" 2>/dev/null || echo "0")
DR=$(echo "$DICT_RESP" | python3 -c "import sys,json;print(len(json.load(sys.stdin).get('downtimeReasons',[])))" 2>/dev/null || echo "0")
[ "$PG" -ge 1 ] && pass "PileGrades: $PG" || fail "PileGrades" "0"
[ "$DT" -ge 1 ] && pass "DrillingTypes: $DT" || fail "DrillingTypes" "0"
[ "$DR" -ge 1 ] && pass "DowntimeReasons: $DR" || fail "DowntimeReasons" "0"

# ═══════════ SUMMARY ═══════════
echo ""
echo -e "${BOLD}════════════════════════════════════════════════${NC}"
echo -e "${BOLD}  ИТОГО: $TOTAL тестов${NC}"
echo -e "  ${GREEN}✅ PASS: $PASS${NC}"
echo -e "  ${RED}❌ FAIL: $FAIL${NC}"
echo -e "  ${YELLOW}⚠️  WARN: $WARN${NC}"
if [ "$FAIL" -eq 0 ]; then
  echo -e "  ${GREEN}${BOLD}Все критические тесты пройдены!${NC}"
else
  echo -e "  ${RED}${BOLD}$FAIL тест(ов) не пройдено!${NC}"
fi
echo -e "${BOLD}════════════════════════════════════════════════${NC}"
echo ""

echo -e "${CYAN}${BOLD}Статистика данных:${NC}"
echo -e "  Оборудование: $EQ_COUNT шт"
echo -e "  Объекты: $SITE_COUNT"
echo -e "  Экипажи: $CREW_COUNT"
echo -e "  Отчёты: $RL_TOTAL"
echo ""

exit $FAIL
