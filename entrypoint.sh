#!/bin/bash
set -e

# Crear el directorio /etc/secrets si no existe
mkdir -p /etc/secrets

# Montaje de sistema de archivos remoto

if [ "$NODE_ENV" = "production" ]; then
  echo "Modo production: montando sistema de archivos remoto con sshfs..."

  # Verifica si se pasó la variable SSH_PRIVATE_KEY y crea el archivo de clave usando SSH_KEY_PATH
  if [ -n "$SSH_PRIVATE_KEY_BASE64" ]; then
    echo "Creando archivo de clave privada en $SSH_KEY_PATH desde Base64"
    echo "$SSH_PRIVATE_KEY_BASE64" | base64 -d > "$SSH_KEY_PATH"
    
    chmod 600 "$SSH_KEY_PATH"
    
    # Debug: Mostrar la clave privada
    # cat "$SSH_KEY_PATH"

    # Debug: Validar la clave privada
    ssh-keygen -lf "$SSH_KEY_PATH"
  else
    echo "No se proporcionó SSH_PRIVATE_KEY_BASE64. Asegúrate de inyectar el secreto."
    exit 1
  fi

  # Verificar si se definieron las variables necesarias para montar sshfs
  if [ -n "$SSH_HOST" ] && [ -n "$SSH_USER" ] && [ -n "$SSHFS_REMOTE_PATH" ] && [ -n "$SSHFS_LOCAL_PATH" ]; then
    echo "Montando sistema de archivos remoto con sshfs..."
    # Crear el directorio local de montaje si no existe
    mkdir -p "$SSHFS_LOCAL_PATH"

    # Debug: Mostrar la ruta de montaje
    # echo "$SSH_USER@$SSH_HOST:$SSHFS_REMOTE_PATH" "$SSHFS_LOCAL_PATH"
  
    # Realiza el montaje con sshfs, deshabilitando la comprobación de host para evitar interacciones
    # Se puede agregar opción -o debug para información de depuración
    sshfs -o StrictHostKeyChecking=no -o IdentityFile="$SSH_KEY_PATH" "$SSH_USER@$SSH_HOST:$SSHFS_REMOTE_PATH" "$SSHFS_LOCAL_PATH"
  else
    echo "Variables SSH_HOST, SSH_USER, SSHFS_REMOTE_PATH y SSHFS_LOCAL_PATH no están definidas completamente, omitiendo montaje sshfs."
  fi

else
  echo "Modo development: utilizando sistema de archivos local en /app/files"
  mkdir -p /app/files
fi

# Inicialización de la base de datos

# Espera a que la base de datos esté lista (asegúrate de definir las variables DB_HOST, DB_USER, DB_NAME y DB_PASS)
until PGPASSWORD="$DB_PASS" psql -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" -c '\q' &> /dev/null; do
  echo "Esperando la conexión a la base de datos..."
  sleep 1
done

# Si la variable de entorno INIT_DB está seteada a "true", se sobre-escribe el esquema public
if [ "$INIT_DB" = "true" ]; then
  echo "La variable INIT_DB está seteada a 'true'. Sobre-escribiendo el esquema de la base de datos..."
  PGPASSWORD="$DB_PASS" psql -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
  echo "Ejecutando init.sql para inicializar la base de datos..."
  PGPASSWORD="$DB_PASS" psql -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" -f /app/init.sql
else
  # Verificar si la base de datos está vacía (por ejemplo, sin tablas en el esquema public)
  TABLE_COUNT=$(PGPASSWORD="$DB_PASS" psql -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" -tAc "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public';")
  if [ "$TABLE_COUNT" -eq 0 ]; then
    echo "La base de datos está vacía. Ejecutando init.sql para inicializar..."
    PGPASSWORD="$DB_PASS" psql -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" -f /app/init.sql
  else
    echo "La base de datos ya tiene contenido."
  fi
fi

# Ejecuta el comando que se definió en CMD
exec "$@"
