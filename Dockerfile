# Usa una imagen base con Node.js
FROM node:24-bookworm

# Actualiza el repositorio e instala sshfs y fuse
RUN apt-get update && apt-get install -y \
    sshfs \
    fuse3 \
    postgresql-client \
    libpq-dev && \
    rm -rf /var/lib/apt/lists/*

# Instalar dependencias
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .

# Copiar el entrypoint script al contenedor
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

# Path a clave privada para utilizar en conexión ssh con servidor
# de archivos
ENV SSH_KEY_PATH="/etc/secrets/id_rsa"

# Exponer el puerto
EXPOSE 3000

# Usar el entrypoint para crear el archivo de clave antes de iniciar la aplicación
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]

# Iniciar la aplicación
CMD ["node", "server.js"]
