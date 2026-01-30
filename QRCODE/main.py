import qrcode
from PIL import Image, ImageDraw, ImageFont
import sys

# --- NOVAS CONFIGURAÇÕES FÍSICAS (O que mudou) ---
LARGURA_PLACA_CM = 12.0  # Nova largura
ALTURA_PLACA_CM = 15.0   # Nova altura

# Tamanho de uma folha A4 (Padrão ISO)
LARGURA_A4_CM = 21.0
ALTURA_A4_CM = 29.7

DPI_ALVO = 300  # Alta resolução para impressão nítida

# --- CONFIGURAÇÕES VISUAIS ---
conteudo_qr = "tel:+5561991685466"
caminho_logo = "logotipo.png"
nome_arquivo_final = "IMPRIMIR_A4_Placa_12x15.png" # Mudei o nome

cor_qr_laranja = "#E96E06"
cor_texto = "black"

texto_linha1_bold = "Bem vindo!"
texto_linha2_normal = "Campainha digital: escaneie o QRCode"

# Ajustes de Design (Levemente reduzidos para o novo tamanho)
tamanho_fonte_bold = 110      # Reduzi um pouco
tamanho_fonte_normal = 70     # Reduzi um pouco
espessura_moldura = 30        # Borda um pouco mais fina
margem_topo_texto = 100
espaco_entre_linhas_texto = 30
espaco_texto_qr = 80

# Configurações do Logo
divisor_tamanho_logo = 5
largura_borda_logo = 12

# --- FUNÇÃO DE CONVERSÃO (CM -> PIXELS) ---
def cm_para_px(cm):
    return int(cm * (DPI_ALVO / 2.54))

# Calcula os novos tamanhos em pixels
LARGURA_PLACA_PX = cm_para_px(LARGURA_PLACA_CM)
ALTURA_PLACA_PX = cm_para_px(ALTURA_PLACA_CM)
LARGURA_A4_PX = cm_para_px(LARGURA_A4_CM)
ALTURA_A4_PX = cm_para_px(ALTURA_A4_CM)

print(f"--- Iniciando Geração 12x15cm em A4 ---")

# ==============================================================================
# FASE 1: CARREGAR FONTES
# ==============================================================================
try:
    # Tenta carregar as fontes da pasta do script
    font_bold = ImageFont.truetype("calibrib.ttf", tamanho_fonte_bold)
    font_normal = ImageFont.truetype("calibri.ttf", tamanho_fonte_normal)
except IOError:
    print("\n" + "="*60)
    print("ERRO CRÍTICO: ARQUIVOS DE FONTE NÃO ENCONTRADOS!")
    print("Certifique-se de que 'calibri.ttf' e 'calibrib.ttf' estão na pasta.")
    print("="*60 + "\n")
    sys.exit()

# ==============================================================================
# FASE 2: CRIAR A PLACA (O MIOLO 12x15)
# ==============================================================================
print(f"1. Criando a placa na medida {LARGURA_PLACA_CM}x{ALTURA_PLACA_CM}cm...")
img_placa = Image.new('RGB', (LARGURA_PLACA_PX, ALTURA_PLACA_PX), "white")
draw_placa = ImageDraw.Draw(img_placa)

# --- Desenhar Textos ---
# Linha 1 (Negrito)
bbox1 = draw_placa.textbbox((0, 0), texto_linha1_bold, font=font_bold)
largura_txt1 = bbox1[2] - bbox1[0]
altura_txt1 = bbox1[3] - bbox1[1]
pos_x_txt1 = (LARGURA_PLACA_PX - largura_txt1) // 2
pos_y_txt1 = margem_topo_texto
draw_placa.text((pos_x_txt1, pos_y_txt1), texto_linha1_bold, font=font_bold, fill=cor_texto)

# Linha 2 (Normal)
bbox2 = draw_placa.textbbox((0, 0), texto_linha2_normal, font=font_normal)
largura_txt2 = bbox2[2] - bbox2[0]
pos_x_txt2 = (LARGURA_PLACA_PX - largura_txt2) // 2
pos_y_txt2 = pos_y_txt1 + altura_txt1 + espaco_entre_linhas_texto
draw_placa.text((pos_x_txt2, pos_y_txt2), texto_linha2_normal, font=font_normal, fill=cor_texto)

# Calcula posição Y do QR Code
pos_y_qr_inicio = pos_y_txt2 + (bbox2[3] - bbox2[1]) + espaco_texto_qr


# --- Gerar e Inserir QR Code ---
# O QR Code terá 80% da largura da placa
largura_qr_alvo = int(LARGURA_PLACA_PX * 0.80)

qr = qrcode.QRCode(
    error_correction=qrcode.constants.ERROR_CORRECT_H,
    box_size=40, # Gera grande para qualidade
    border=1
)
qr.add_data(conteudo_qr)
qr.make(fit=True)
img_qr_raw = qr.make_image(fill_color=cor_qr_laranja, back_color="white").convert('RGB')
# Redimensiona para o tamanho alvo
img_qr_final = img_qr_raw.resize((largura_qr_alvo, largura_qr_alvo), Image.Resampling.LANCZOS)

# --- Inserir Logo no QR ---
try:
    img_logo = Image.open(caminho_logo)
    # Tamanho do logo (1/5 do QR)
    tamanho_logo_px = largura_qr_alvo // divisor_tamanho_logo
    img_logo.thumbnail((tamanho_logo_px, tamanho_logo_px), Image.Resampling.LANCZOS)

    # Respiro branco
    tam_respiro = img_logo.width + (largura_borda_logo * 2)
    img_respiro = Image.new('RGBA', (tam_respiro, tam_respiro), "white")
    
    # Centraliza logo no respiro
    px = (tam_respiro - img_logo.width) // 2
    py = (tam_respiro - img_logo.height) // 2
    
    if img_logo.mode in ('RGBA', 'LA') or ('transparency' in img_logo.info):
        mask = img_logo.convert('RGBA').split()[-1]
        img_respiro.paste(img_logo, (px, py), mask)
    else:
        img_respiro.paste(img_logo, (px, py))
        
    # Cola respiro no centro do QR Final
    pos_x_logo_qr = (img_qr_final.width - img_respiro.width) // 2
    pos_y_logo_qr = (img_qr_final.height - img_respiro.height) // 2
    img_qr_final.paste(img_respiro, (pos_x_logo_qr, pos_y_logo_qr))

except FileNotFoundError:
     print(f"AVISO: Logo não encontrado. Gerando sem.")

# --- Colar QR Code na Placa ---
pos_x_qr_na_placa = (LARGURA_PLACA_PX - img_qr_final.width) // 2
img_placa.paste(img_qr_final, (pos_x_qr_na_placa, pos_y_qr_inicio))

# --- Desenhar Moldura Laranja da Placa ---
draw_placa.rectangle(
    [(0, 0), (LARGURA_PLACA_PX - 1, ALTURA_PLACA_PX - 1)],
    outline=cor_qr_laranja,
    width=espessura_moldura
)


# ==============================================================================
# FASE 3: COLOCAR NA FOLHA A4 COM MARCAS DE CORTE
# ==============================================================================
print("2. Centralizando na folha A4 e criando guias de corte...")
img_a4 = Image.new('RGB', (LARGURA_A4_PX, ALTURA_A4_PX), "white")
draw_a4 = ImageDraw.Draw(img_a4)

# Calcula centro da folha A4
pos_x_placa_a4 = (LARGURA_A4_PX - LARGURA_PLACA_PX) // 2
pos_y_placa_a4 = (ALTURA_A4_PX - ALTURA_PLACA_PX) // 2

# Cola a placa
img_a4.paste(img_placa, (pos_x_placa_a4, pos_y_placa_a4))

# --- Desenhar Marcas de Corte (Guias Cinzas) ---
cor_guia = "#999999"
tam_guia = 60 # Tamanho do tracinho
espessura_guia = 4

# Cantos superiores
draw_a4.line([(pos_x_placa_a4 - tam_guia, pos_y_placa_a4), (pos_x_placa_a4, pos_y_placa_a4)], fill=cor_guia, width=espessura_guia) # Topo Esq Horizontal
draw_a4.line([(pos_x_placa_a4, pos_y_placa_a4 - tam_guia), (pos_x_placa_a4, pos_y_placa_a4)], fill=cor_guia, width=espessura_guia) # Topo Esq Vertical

x_dir = pos_x_placa_a4 + LARGURA_PLACA_PX
draw_a4.line([(x_dir, pos_y_placa_a4), (x_dir + tam_guia, pos_y_placa_a4)], fill=cor_guia, width=espessura_guia) # Topo Dir Horizontal
draw_a4.line([(x_dir, pos_y_placa_a4 - tam_guia), (x_dir, pos_y_placa_a4)], fill=cor_guia, width=espessura_guia) # Topo Dir Vertical

# Cantos inferiores
y_base = pos_y_placa_a4 + ALTURA_PLACA_PX
draw_a4.line([(pos_x_placa_a4 - tam_guia, y_base), (pos_x_placa_a4, y_base)], fill=cor_guia, width=espessura_guia) # Base Esq Horizontal
draw_a4.line([(pos_x_placa_a4, y_base), (pos_x_placa_a4, y_base + tam_guia)], fill=cor_guia, width=espessura_guia) # Base Esq Vertical

draw_a4.line([(x_dir, y_base), (x_dir + tam_guia, y_base)], fill=cor_guia, width=espessura_guia) # Base Dir Horizontal
draw_a4.line([(x_dir, y_base), (x_dir, y_base + tam_guia)], fill=cor_guia, width=espessura_guia) # Base Dir Vertical


# ==============================================================================
# FASE 4: SALVAR
# ==============================================================================
img_a4.save(nome_arquivo_final, dpi=(DPI_ALVO, DPI_ALVO))

print(f"\n" + "="*60)
print(f"SUCESSO! Imagem gerada: {nome_arquivo_final}")
print(f"Medida interna da placa: 12cm x 15cm")
print(f"Formato do arquivo: Folha A4 completa com marcas de corte.")
print(f"="*60)