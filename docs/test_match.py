import requests
import json

BASE_URL = "http://192.168.51.240/api"

# Test cases from TZ 4.11.4
test_cases = [
    "Сера молотая для сельского хозяйства",
    "Кальций йодат моногидрат 62%",
    "Монокальцийфосфат (фосфаты обесфторенные кормовые)",
    "Соль пищевая выварочная сорт экстра",
    "Бикарбонат натрия",
    "Гидрокарбонат натрия пищевая добавка Е500 (ii)",
    "Калия карбонат К299-26 гранулированный кормовой",
    "Кальций хлористый пищевой Fudix",
    "Луктаром молочно-ванил",
    "Хромосодержащие дрожжи",
]

print("Testing alias recognition...")
print("=" * 60)

for test_name in test_cases:
    # Use the ai-suggest endpoint to test matching
    try:
        response = requests.post(f"{BASE_URL}/synonyms/ai-suggest", 
                               json={"items": [test_name]}, 
                               timeout=5)
        if response.status_code == 200:
            data = response.json()
            if data and len(data) > 0:
                suggestion = data[0]
                if suggestion.get('suggested_raw_uid'):
                    print(f"OK: {test_name}")
                    print(f"   -> {suggestion['suggested_raw_uid']} ({suggestion.get('confidence', 'unknown')})")
                else:
                    print(f"FAIL: {test_name}")
                    print(f"   -> No match found")
            else:
                print(f"FAIL: {test_name}")
                print(f"   -> Empty response")
        else:
            print(f"ERROR: {test_name}")
            print(f"   -> {response.status_code}: {response.text}")
    except Exception as e:
        print(f"ERROR: {test_name}")
        print(f"   -> {str(e)}")
    print()

print("=" * 60)
print("Done!")
