# Despliegue en Oracle Cloud Always Free

Resultado: backend en `https://<tu-subdominio>.duckdns.org` con HTTPS automático,
0 €/mes, 10 TB de salida mensual incluidos.

## 1. Crear la VM (una vez)

1. Cuenta en [oracle.com/cloud/free](https://www.oracle.com/cloud/free/) (pide tarjeta para verificar, no cobra).
2. **Compute → Instances → Create instance**:
   - Image: **Ubuntu 24.04**.
   - Shape: **Ampere A1.Flex** (Always Free): 2 OCPU y 12 GB bastan de sobra
     (puedes pedir hasta 4 OCPU / 24 GB; si da "out of capacity", prueba otra
     Availability Domain o reintenta en otro momento).
   - Sube tu clave SSH pública.
3. Anota la **IP pública**.

## 2. Abrir puertos 80 y 443

Dos sitios (ambos obligatorios en Oracle):

- **Consola web**: Networking → Virtual Cloud Networks → tu VCN → Security List
  → Add Ingress Rules: TCP 80 y TCP 443 desde `0.0.0.0/0`.
- **Dentro de la VM** (Ubuntu trae iptables restrictivo):
  ```bash
  sudo iptables -I INPUT -p tcp --dport 80 -j ACCEPT
  sudo iptables -I INPUT -p tcp --dport 443 -j ACCEPT
  sudo netfilter-persistent save
  ```

## 3. Dominio gratis (DuckDNS)

1. Entra en [duckdns.org](https://www.duckdns.org) (login con GitHub/Google).
2. Crea un subdominio, p. ej. `edadplay` → `edadplay.duckdns.org`.
3. Apunta su IP a la IP pública de la VM.

## 4. Instalar Docker y desplegar

```bash
ssh ubuntu@<IP>
sudo apt-get update && sudo apt-get install -y docker.io docker-compose-v2 git
sudo usermod -aG docker ubuntu && newgrp docker

git clone https://github.com/<tu-usuario>/edadplay.git
cd edadplay/backend

DOMAIN=edadplay.duckdns.org \
ALLOWED_ORIGINS=https://<tu-usuario>.github.io \
docker compose up -d --build
```

Comprueba: `https://edadplay.duckdns.org/api/health` debe devolver
`{"ok": true, "ytdlp": "...", "pot_provider": true, ...}`.

## 5. Conectar el frontend

En `docs/js/config.js`:

```js
export const BACKEND_URL = 'https://edadplay.duckdns.org';
```

Commit + push → GitHub Pages se actualiza y la pestaña YouTube queda activa.

## Fiabilidad anti-bloqueo (ya incluida)

| Capa | Qué hace |
|---|---|
| PO Token provider (bgutil) | Genera tokens de "prueba de origen"; es la solución oficial recomendada por yt-dlp para IPs de datacenter |
| Cadena de clientes | Si el cliente por defecto falla, reintenta con `mweb`, `web_safari` y `tv_embedded` |
| Autoactualización | yt-dlp se actualiza solo cada 12 h (la mayoría de roturas se arreglan actualizando) |
| Errores claros | El frontend distingue bloqueo temporal, vídeo privado, geobloqueo, duración excesiva o web no soportada |

### Capa extra opcional: cookies

Si aun así YouTube bloquea con frecuencia, exporta cookies de una cuenta
**desechable** (nunca la personal — riesgo de baneo):

1. En un navegador donde esa cuenta tenga sesión en YouTube, exporta
   `cookies.txt` (extensión "Get cookies.txt LOCALLY").
2. Súbelo a la VM: `scp cookies.txt ubuntu@<IP>:~/edadplay/backend/`.
3. En `docker-compose.yml`, descomenta `COOKIES_FILE` y el volumen, y
   `docker compose up -d`.

Caducan en ~2 semanas; renueva si vuelven los bloqueos.

## Mantenimiento

```bash
docker compose logs -f backend     # ver actividad
docker compose pull && docker compose up -d --build   # actualizar imágenes
```

## Otras plataformas

yt-dlp soporta ~1.800 sitios. Probado bien desde datacenter: **Vimeo,
Dailymotion, Twitch (VODs), TikTok, Reddit, X/Twitter**. Con login obligatorio
(fallarán sin cookies): Instagram, Facebook. YouTube es el único con bloqueo
activo de datacenters; el resto rara vez falla.
