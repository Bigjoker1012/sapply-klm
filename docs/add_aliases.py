import requests
import json

BASE_URL = "http://192.168.51.240/api"

# Aliases to add from TZ 4.11.4 audit
aliases = [
    {"raw_uid": "RAW_013", "alias": "Сера молотая для сельского хозяйства", "source": "audit_4.11.4"},
    {"raw_uid": "RAW_019", "alias": "Кальций йодат моногидрат 62%", "source": "audit_4.11.4"},
    {"raw_uid": "RAW_024", "alias": "Монокальцийфосфат (фосфаты обесфторенные кормовые)", "source": "audit_4.11.4"},
    {"raw_uid": "RAW_026", "alias": "Соль пищевая выварочная сорт экстра", "source": "audit_4.11.4"},
    {"raw_uid": "RAW_027", "alias": "Бикарбонат натрия", "source": "audit_4.11.4"},
    {"raw_uid": "RAW_027", "alias": "Гидрокарбонат натрия пищевая добавка Е500 (ii)", "source": "audit_4.11.4"},
    {"raw_uid": "RAW_050", "alias": "Калия карбонат К299-26 гранулированный кормовой", "source": "audit_4.11.4"},
    {"raw_uid": "RAW_052", "alias": "Кальций хлористый пищевой Fudix", "source": "audit_4.11.4"},
    {"raw_uid": "RAW_060", "alias": "Луктаром молочно-ванил", "source": "audit_4.11.4"},
    {"raw_uid": "RAW_066", "alias": "Хромосодержащие дрожжи", "source": "audit_4.11.4"},
]

print("Adding aliases from TZ 4.11.4 audit...")

for alias in aliases:
    try:
        response = requests.post(f"{BASE_URL}/synonyms", json=alias, timeout=5)
        if response.status_code == 200:
            print(f"OK: {alias['alias']} -> {alias['raw_uid']}")
        else:
            print(f"FAIL: {alias['alias']} - {response.status_code}: {response.text}")
    except Exception as e:
        print(f"ERROR: {alias['alias']} - {str(e)}")

print("\nDone!")
