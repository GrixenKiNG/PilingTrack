"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

/**
 * Последний рубеж: этот компонент заменяет корневой layout, поэтому стили
 * globals.css здесь недоступны — оформление задано инлайном, чтобы страница
 * выглядела одинаково при любом сбое. Текст по-русски и с шагом «Обновить».
 */
export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string };
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="ru">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#f8fafc",
          color: "#0f172a",
          fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
        }}
      >
        <div style={{ maxWidth: 420, padding: 24, textAlign: "center" }}>
          <h1 style={{ fontSize: 22, margin: "0 0 8px" }}>
            Приложение не открылось
          </h1>
          <p style={{ fontSize: 14, color: "#475569", margin: "0 0 24px" }}>
            Экран не открылся из-за ошибки. Обновите страницу; если повторится — сообщите администратору.
          </p>
          <button
            onClick={() => window.location.reload()}
            style={{
              padding: "10px 20px",
              fontSize: 14,
              border: 0,
              borderRadius: 8,
              background: "#c04300",
              color: "#ffffff",
              cursor: "pointer",
            }}
          >
            Обновить
          </button>
        </div>
      </body>
    </html>
  );
}