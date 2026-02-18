import pandas as pd
import requests
import json
import warnings

# Ignora avisos do Excel
warnings.simplefilter("ignore")

# ============================================================
# CONFIGURAÇÕES
# ============================================================
SHEET_ID = "1_iMiIIZ1zpEbDq-KCzb_RaiyosS5zUeQCmHZyYXT_B0"
# IMPORTANTE: Mudamos para xlsx para ler TODAS as abas
SHEET_URL = f"https://docs.google.com/spreadsheets/d/{SHEET_ID}/export?format=xlsx"

# DEFINA SEU AMBIENTE (Local ou Produção)
BASE_URL = "https://telefluxo-aplicacao.onrender.com" 
# BASE_URL = "http://localhost:3000" # Descomente para testar localmente

# ROTAS
API_URL_ANTIGA = f"{BASE_URL}/api/sync/compras"           # Alimenta o menu Compras
API_URL_NOVA   = f"{BASE_URL}/api/sync/compras-pendentes" # Alimenta o Estoque x Vendas

print("🚀 Iniciando Sincronização Unificada (Híbrida)...")

try:
    print("⬇️ Baixando planilha completa (todas as abas)...")
    # Lê todas as abas de uma vez
    all_sheets = pd.read_excel(SHEET_URL, sheet_name=None, header=0) 
    print(f"📚 Abas encontradas: {list(all_sheets.keys())}")

    # --- LISTAS DE DADOS ---
    payload_antigo = []       # Lista detalhada (com região, previsão)
    acumulador_novo = {}      # Dicionário para somar totais (Modelo -> Quantidade)

    # Índices das colunas (Baseado no seu script original)
    IDX_DESC = 6   # Coluna G (Descrição/Modelo)
    IDX_QTD  = 14  # Coluna O (Quantidade)

    # LOOP PELAS ABAS
    for nome_aba, df in all_sheets.items():
        print(f"   Processando aba: {nome_aba}...")
        
        # Tenta achar a coluna de região dinamicamente nesta aba
        # Se não achar 'regi', pega a 3ª coluna (index 2) como fallback
        col_region_name = next((c for c in df.columns if 'regi' in str(c).lower()), df.columns[2])

        for index, row in df.iterrows():
            try:
                vals = row.values
                if len(vals) <= IDX_QTD: continue

                # 1. Tratamento de Dados
                desc = str(vals[IDX_DESC]).strip().upper()
                reg  = str(row[col_region_name]).strip().upper()
                
                # Limpeza da quantidade
                qtd_str = str(vals[IDX_QTD]).replace('.', '').replace(',', '.')
                try: qtd = int(float(qtd_str))
                except: qtd = 0

                # Validação básica
                if qtd > 0 and desc != 'NAN' and desc != '' and desc != 'MODELO':
                    
                    # --- PREPARAÇÃO PARA SISTEMA ANTIGO (DETALHADO) ---
                    # Pega as previsões (Colunas W...)
                    previsao = {}
                    for col in df.columns:
                        if str(col).upper().startswith('W'):
                            try:
                                val = float(row[col])
                                if val > 0: previsao[col] = int(val)
                            except: pass
                    
                    payload_antigo.append({
                        "descricao": desc,
                        "regiao": reg,     # Mantém a região para o sistema antigo
                        "qtd": qtd,
                        "previsao": previsao
                    })

                    # --- PREPARAÇÃO PARA SISTEMA NOVO (SOMA TOTAL) ---
                    # Soma tudo no acumulador, independente da região/aba
                    if desc in acumulador_novo:
                        acumulador_novo[desc] += qtd
                    else:
                        acumulador_novo[desc] = qtd

            except Exception as e:
                continue

    # ============================================================
    # ENVIO 1: SISTEMA ANTIGO (Menu Compras)
    # ============================================================
    print(f"\n📡 Enviando {len(payload_antigo)} itens para o SISTEMA ANTIGO...")
    if len(payload_antigo) > 0:
        try:
            r = requests.post(API_URL_ANTIGA, json={"compras": payload_antigo})
            if r.status_code == 200:
                print("✅ Sistema Antigo atualizado com sucesso!")
            else:
                print(f"❌ Falha no Antigo: {r.status_code} - {r.text}")
        except Exception as e:
            print(f"❌ Erro de conexão Antigo: {e}")

    # ============================================================
    # ENVIO 2: SISTEMA NOVO (Estoque x Vendas)
    # ============================================================
    # Transforma o acumulador em lista
    payload_novo = [{"modelo": k, "quantidade_pendente": v} for k, v in acumulador_novo.items()]
    
    print(f"📡 Enviando {len(payload_novo)} modelos somados para o SISTEMA NOVO...")
    if len(payload_novo) > 0:
        try:
            r = requests.post(API_URL_NOVA, json=payload_novo)
            if r.status_code == 200:
                print("✅ Sistema Novo (Pendente) atualizado com sucesso!")
            else:
                print(f"❌ Falha no Novo: {r.status_code} - {r.text}")
        except Exception as e:
            print(f"❌ Erro de conexão Novo: {e}")

    print("\n🏁 Sincronização Finalizada.")

except Exception as e:
    print(f"❌ Erro Fatal no Script: {e}")