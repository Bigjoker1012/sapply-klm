#!/bin/bash

# Add aliases from TZ 4.11.4 audit

aliases=(
  '{"raw_uid":"RAW_013","synonym":"Сера молотая для сельского хозяйства","source":"audit_4.11.4"}'
  '{"raw_uid":"RAW_019","synonym":"Кальций йодат моногидрат 62%","source":"audit_4.11.4"}'
  '{"raw_uid":"RAW_024","synonym":"Монокальцийфосфат (фосфаты обесфторенные кормовые)","source":"audit_4.11.4"}'
  '{"raw_uid":"RAW_026","synonym":"Соль пищевая выварочная сорт экстра","source":"audit_4.11.4"}'
  '{"raw_uid":"RAW_027","synonym":"Бикарбонат натрия","source":"audit_4.11.4"}'
  '{"raw_uid":"RAW_027","synonym":"Гидрокарбонат натрия пищевая добавка Е500 (ii)","source":"audit_4.11.4"}'
  '{"raw_uid":"RAW_050","synonym":"Калия карбонат К299-26 гранулированный кормовой","source":"audit_4.11.4"}'
  '{"raw_uid":"RAW_052","synonym":"Кальций хлористый пищевой Fudix","source":"audit_4.11.4"}'
  '{"raw_uid":"RAW_060","synonym":"Луктаром молочно-ванил","source":"audit_4.11.4"}'
  '{"raw_uid":"RAW_066","synonym":"Хромосодержащие дрожжи","source":"audit_4.11.4"}'
)

echo "Adding aliases from TZ 4.11.4 audit..."

for alias in "${aliases[@]}"; do
  echo "$alias" > /tmp/temp_alias.json
  result=$(curl -s -X POST http://localhost:3001/api/synonyms -H 'Content-Type: application/json' -d @/tmp/temp_alias.json)
  echo "Result: $result"
done

echo "Done!"
