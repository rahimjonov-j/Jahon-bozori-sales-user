# Hengtai SVG Shop Status

Hozirgi versiya frontend-only mock rejimda ishlaydi.

- Statuslar `localStorage` ichida saqlanadi
- UI `shop_id` bo'yicha SVG ni bo'yaydi
- Sales text lokal parser bilan `shop_id + status` ga aylantiriladi
- Tablar orasida `BroadcastChannel` orqali sinxron yangilanadi

Keyingi bosqichda shu oqimni real backendga ulash mumkin.

## Hozir nima ishlaydi

- `available` -> default / fill yo'q
- `reserved` -> sariq
- `sold` -> qizil
- Hover -> shop info
- Click -> detail modal
- Legend -> status ranglari
- Raw sales text -> mock parse -> local update

## Muhim eslatma

Hozirgi SVG fayllarda shop label lar bor, lekin native room element ID lar hali yo'q.

Shuning uchun frontend runtime paytida har bir shop uchun `shop_id` bilan alohida SVG node tayyorlaydi va statusni shu nodega qo'llaydi. Shu sababli keyin haqiqiy backend qo'shilganda ham `shop_id` kontrakti o'zgarmaydi.

## Ishga tushirish

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

## Mock parser misollar

- `A-5-112 sotildi`
- `A blok 5 qavat 112 bron qilindi`
- `A 5 112 sotuv bo'ldi`

Natija:

```json
{
  "shop_id": "A-5-112",
  "status": "sold"
}
```

## Keyin backend qo'shish

Backend uchun poydevor fayllar qoldirilgan:

- `server/`
- `shared/`

Lekin hozirgi ish rejimida ular majburiy emas. Asosiy oqim frontend ichida mock/local store bilan ishlaydi.
