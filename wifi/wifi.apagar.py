import segno
from segno import helpers  # Importação explícita do submódulo helpers

# Configurações da rede
nome_wifi = "Telecel" 
senha_wifi = "9PUNFNDH9NEU"
seguranca = "WPA" 

# Note que agora usamos helpers.make_wifi diretamente
qrcode_wifi = helpers.make_wifi(
    ssid=nome_wifi, 
    password=senha_wifi, 
    security=seguranca
)

# Salvando o arquivo
qrcode_wifi.save("wifi_qr.png", scale=10)

print(f"QR Code para a rede '{nome_wifi}' gerado com sucesso!")