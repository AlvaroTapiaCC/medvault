#!/bin/bash
set -e

# Crear el directorio /etc/secrets si no existe
mkdir -p /etc/secrets

# ============================================================================
# MODO PRODUCCIÓN
# ============================================================================
if [ "$NODE_ENV" = "production" ]; then
  echo "Modo production: configurando entorno seguro..."

  # Clave privada SSH para montar sistema de archivos remoto
  if [ -n "$SSH_PRIVATE_KEY_BASE64" ]; then
    echo "Creando archivo de clave SSH en $SSH_KEY_PATH"
    echo "$SSH_PRIVATE_KEY_BASE64" | base64 -d > "$SSH_KEY_PATH"
    chmod 600 "$SSH_KEY_PATH"
    ssh-keygen -lf "$SSH_KEY_PATH"
  else
    echo "No se proporcionó SSH_PRIVATE_KEY_BASE64. Asegúrate de inyectar el secreto."
    exit 1
  fi

  # Clave privada del certificado TLS para HTTP/2
  if [ -n "$CERTIFICATE_PRIVATE_KEY_BASE64" ]; then
    echo "Creando archivo de clave privada del certificado en $CERTIFICATE_PRIVATE_KEY_PATH"
    echo "$CERTIFICATE_PRIVATE_KEY_BASE64" | base64 -d > "$CERTIFICATE_PRIVATE_KEY_PATH"
    chmod 600 "$CERTIFICATE_PRIVATE_KEY_PATH"
    ssh-keygen -lf "$CERTIFICATE_PRIVATE_KEY_PATH"
  else
    echo "No se proporcionó CERTIFICATE_PRIVATE_KEY_BASE64. La app iniciará sin HTTP/2."
  fi

  # Montar sistema de archivos remoto con sshfs
  if [ -n "$SSH_HOST" ] && [ -n "$SSH_USER" ] && [ -n "$SSHFS_REMOTE_PATH" ] && [ -n "$SSHFS_LOCAL_PATH" ]; then
    echo "Montando sistema de archivos remoto con sshfs..."
    mkdir -p "$SSHFS_LOCAL_PATH"
    sshfs -o StrictHostKeyChecking=no -o IdentityFile="$SSH_KEY_PATH" "$SSH_USER@$SSH_HOST:$SSHFS_REMOTE_PATH" "$SSHFS_LOCAL_PATH"
  else
    echo "Variables SSH no definidas completamente. Omitiendo montaje sshfs."
  fi

else
  echo "Modo development: utilizando sistema de archivos local en /app/files"
  mkdir -p /app/files
fi

# ============================================================================
# INICIALIZACIÓN DE LA BASE DE DATOS
# ============================================================================

# Determinar opciones SSL para psql según el entorno
if [ "$NODE_ENV" = "production" ] && [ -f "/app/certs/db.crt" ]; then
  SSL_OPTS="sslmode=require&sslrootcert=/app/certs/db.crt"
  DB_URL="postgresql://$DB_USER@$DB_HOST/$DB_NAME?$SSL_OPTS"

  until PGPASSWORD="$DB_PASS" psql "$DB_URL" -c '\q' &> /dev/null; do
    echo "Esperando la conexión a la base de datos (con TLS)..."
    sleep 1
  done

  if [ "$INIT_DB" = "true" ]; then
    echo "Inicializando base de datos (modo TLS)..."
    PGPASSWORD="$DB_PASS" psql "$DB_URL" -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
    PGPASSWORD="$DB_PASS" psql "$DB_URL" -f /app/init.sql
  else
    TABLE_COUNT=$(PGPASSWORD="$DB_PASS" psql "$DB_URL" -tAc "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public';")
    if [ "$TABLE_COUNT" -eq 0 ]; then
      echo "Base de datos vacía. Ejecutando init.sql..."
      PGPASSWORD="$DB_PASS" psql "$DB_URL" -f /app/init.sql
    else
      echo "La base de datos ya tiene contenido."
    fi
  fi

else
  until PGPASSWORD="$DB_PASS" psql -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" -c '\q' &> /dev/null; do
    echo "Esperando la conexión a la base de datos..."
    sleep 1
  done

  if [ "$INIT_DB" = "true" ]; then
    echo "Inicializando base de datos..."
    PGPASSWORD="$DB_PASS" psql -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
    PGPASSWORD="$DB_PASS" psql -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" -f /app/init.sql
  else
    TABLE_COUNT=$(PGPASSWORD="$DB_PASS" psql -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" -tAc "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public';")
    if [ "$TABLE_COUNT" -eq 0 ]; then
      echo "Base de datos vacía. Ejecutando init.sql..."
      PGPASSWORD="$DB_PASS" psql -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" -f /app/init.sql
    else
      echo "La base de datos ya tiene contenido."
    fi
  fi
fi

# ============================================================================
# MIGRACIÓN DE CONTRASEÑAS A BCRYPT
# Idempotente: solo migra usuarios con password_plain != NULL
# ============================================================================
echo "Ejecutando migración de contraseñas a bcrypt..."
node /app/scripts/hash-passwords.js

# Ejecuta el comando definido en CMD (node server.js)
exec "$@"
