#!/usr/bin/env bash
# Arma la carpeta de un asistente personal desde la base de este kit.
# Copia assets/base/ al destino, pone el nombre del asistente en profile.json y deja `configured: false` para
# que la primera sesión de Claude Code lance la entrevista de arranque.
# No se conecta a internet, no instala nada y no toca nada fuera del destino.
#
# Uso: bash crear-asistente.sh "<carpeta destino>" ["<nombre del asistente>"]
set -euo pipefail

DEST="${1:-}"
NAME="${2:-asistente}"
[ -n "$DEST" ] || { echo "Uso: bash crear-asistente.sh \"<carpeta destino>\" [\"<nombre del asistente>\"]" >&2; exit 2; }

HERE="$(cd "$(dirname "$0")" && pwd)"
BASE="$HERE/../assets/base"
[ -d "$BASE" ] || { echo "No encuentro la base en $BASE" >&2; exit 1; }

# Se niega a escribir sobre una carpeta que ya tiene cosas.
if [ -e "$DEST" ] && [ -n "$(ls -A "$DEST" 2>/dev/null)" ]; then
  echo "La carpeta '$DEST' ya tiene contenido. Elige una carpeta nueva o vacía." >&2
  exit 1
fi
# El nombre se escribe dentro de un JSON: sin comillas, barras ni ampersands.
case "$NAME" in *\"*|*\\*|*\&*|*/*) echo "El nombre no puede llevar comillas, barras ni &." >&2; exit 2;; esac

mkdir -p "$DEST/.claude/agents" "$DEST/.claude/skills"
cp "$BASE/CLAUDE.plantilla.md" "$DEST/CLAUDE.md"
cp "$BASE/profile.json" "$DEST/profile.json"
cp "$BASE/ajustes.json" "$DEST/.claude/settings.json"
cp "$BASE"/agentes/*.md "$DEST/.claude/agents/"
for d in "$BASE"/skills/*/; do
  n="$(basename "$d")"
  mkdir -p "$DEST/.claude/skills/$n"
  cp "$d/SKILL.plantilla.md" "$DEST/.claude/skills/$n/SKILL.md"
done
cp -R "$BASE/vault" "$DEST/vault"

# Nombre del asistente en profile.json (compatible con macOS y Linux).
tmp="$(mktemp)"
sed "s/\"assistant_name\": \"asistente\"/\"assistant_name\": \"$NAME\"/" "$DEST/profile.json" > "$tmp"
mv "$tmp" "$DEST/profile.json"
grep -q "\"assistant_name\": \"$NAME\"" "$DEST/profile.json" || { echo "No pude poner el nombre en profile.json: la base cambió." >&2; exit 1; }

echo "Listo. Tu asistente '$NAME' quedó en: $DEST"
echo "Siguiente paso: abre esa carpeta en Claude Code y escribe: empezar"
