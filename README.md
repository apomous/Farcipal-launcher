<img width="512" height="512" alt="farcipal-icon-512" src="https://github.com/user-attachments/assets/8a39ea5f-5dff-476d-abb3-08031cadd0cf" />

# FARCIPAL Launcher

Лаунчер Minecraft Java на Electron. Дизайн и глаз-компаньон из FARCIPAL EYE.

## Запуск
```
npm install
npm start          # открыть приложение
npm run dist       # собрать portable .exe в папку dist/
```
Нужна Java: 17+ для 1.18–1.20.4, 21+ для 1.20.5 и новее (например, Temurin с adoptium.net).

## Что внутри
- `main.js`: окно, список версий Mojang, вход через Microsoft (msmc), запуск (minecraft-launcher-core).
- `renderer/companion.js`: глаз, живая сеть нитей (класс `Thread`), рывок по кнопке. API: `Companion.slam()`, `Companion.phase('idle'|'loading'|'running'|'error')`.
  Элементы, за которые цепляется сеть, задаются селектором в `app.js` (`targets: ".panel, .card, .play"`).
- `config.js`: сервер для автозахода, новости, папка игры.

## Вход и демо
Без входа игра запускается в демо-режиме Mojang (флаг `--demo`, ограничение накладывает сам клиент).
С Microsoft-аккаунтом без купленной игры тоже запустится демо.

## Не сделано
- Автоскачивание Java (сейчас только проверка версии и понятная ошибка).
- Загрузка новостей с твоего сайта (сейчас список в `config.js`).
