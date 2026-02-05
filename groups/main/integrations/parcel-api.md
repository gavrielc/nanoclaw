# Parcel API - Integração para Adicionar Encomendas

## Visão Geral

A API do Parcel permite adicionar encomendas automaticamente à app Parcel através de automações.

## Configuração

### 1. Obter API Key

1. Aceder a https://web.parcelapp.net
2. Gerar uma API key (requer subscrição Premium)
3. Guardar a key em `/workspace/group/secrets.json`:

```json
{
  "parcel_api_key": "YOUR_API_KEY_HERE"
}
```

### 2. Endpoint

```
POST https://api.parcel.app/external/add-delivery/
```

### 3. Autenticação

Header HTTP:
```
api-key: YOUR_API_KEY
```

## Parâmetros

### Obrigatórios

- `tracking_number` (string) - Número de tracking da encomenda
- `carrier_code` (string) - Código interno da transportadora
- `description` (string) - Descrição da encomenda

### Opcionais

- `language` (string) - Código ISO 639-1 (2 letras), default: inglês
- `send_push_confirmation` (bool) - Notificação push quando adicionada, default: false

## Carrier Codes Comuns

Para obter lista completa: https://api.parcel.app/carriers

Códigos comuns em Portugal:
- `ctt` - CTT (Correios de Portugal)
- `ctt-express` - CTT Expresso
- `dhl` - DHL
- `ups` - UPS
- `fedex` - FedEx
- `dpd-portugal` - DPD Portugal
- `amazon` - Amazon Logistics
- `pholder` - Placeholder (quando não se sabe a transportadora)

## Exemplo de Utilização

### cURL

```bash
curl "https://api.parcel.app/external/add-delivery/" \
  -H "api-key: YOUR_API_KEY" \
  --request POST \
  --data '{
    "tracking_number": "DW898346460PT",
    "carrier_code": "ctt-express",
    "description": "Encomenda Amazon",
    "send_push_confirmation": true
  }'
```

### Python

```python
import requests
import json

url = "https://api.parcel.app/external/add-delivery/"
headers = {
    "api-key": "YOUR_API_KEY",
    "Content-Type": "application/json"
}
data = {
    "tracking_number": "DW898346460PT",
    "carrier_code": "ctt-express",
    "description": "Encomenda Amazon",
    "send_push_confirmation": True
}

response = requests.post(url, headers=headers, json=data)
print(response.json())
```

### Bash (para uso do Joca)

```bash
# Ler API key do ficheiro de secrets
API_KEY=$(jq -r '.parcel_api_key' /workspace/group/secrets.json)

# Adicionar encomenda
curl "https://api.parcel.app/external/add-delivery/" \
  -H "api-key: $API_KEY" \
  -H "Content-Type: application/json" \
  --request POST \
  --data "{
    \"tracking_number\": \"$TRACKING_NUMBER\",
    \"carrier_code\": \"$CARRIER_CODE\",
    \"description\": \"$DESCRIPTION\",
    \"send_push_confirmation\": true
  }"
```

## Limitações

- **20 requests por dia** (máximo)
- Requests falhados contam para o limite
- Requer subscrição Premium do Parcel
- Apenas uma encomenda por request
- Tracking numbers que requerem input adicional não podem ser submetidos via API
- Novas encomendas não mostram dados de tracking imediatamente

## Automação de Emails de Tracking

Quando o Joca receber um email de tracking (CTT, DHL, etc.):

1. Extrair tracking number do email
2. Identificar transportadora (carrier_code)
3. Extrair PIN se existir (para incluir na descrição)
4. Chamar API do Parcel para adicionar automaticamente
5. Notificar via WhatsApp se adicionado com sucesso
6. Marcar email como lido e deixar na inbox

### Mapeamento de Transportadoras

| Remetente Email | Carrier Code |
|----------------|--------------|
| `*@cttexpresso.pt` | `ctt-express` |
| `*@ctt.pt` | `ctt` |
| `*@dhl.pt` | `dhl` |
| `*@ups.com` | `ups` |
| `*@fedex.com` | `fedex` |
| `*@dpd.pt` | `dpd-portugal` |
| `*@amazon.*` | `amazon` |

## Recursos

- Documentação oficial: https://parcelapp.net/help/api-add-delivery.html
- Lista de transportadoras suportadas: https://api.parcel.app/carriers (endpoint JSON)
- Suporte: support@parcelapp.net
- Web interface: https://web.parcelapp.net

## Notas

- A API é apenas para utilizadores Premium
- A key deve ser mantida segura e nunca commitada ao git
- Verificar rate limit antes de automação intensiva
- Considerar fallback para notificação WhatsApp se API falhar
