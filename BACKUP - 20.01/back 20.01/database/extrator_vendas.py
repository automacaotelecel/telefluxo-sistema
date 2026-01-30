# ===========================================
# ⚡ RELATÓRIO DE VENDAS MICROVIX – VERSÃO TELEFLUXO (CORRIGIDA)
# Salva em: TeleFluxo_Instalador/database/samsung_vendas.db
# ===========================================

import requests
from requests.auth import HTTPBasicAuth
import pandas as pd
from lxml import etree
from datetime import datetime
import sqlite3, os, time, sys
import logging
import numpy as np

# --- CONFIGURAÇÕES ---
USUARIO = "linx_export"
SENHA = "linx_export"
CHAVE = "2618f2b2-8f1d-4502-8321-342dc2cd1470"
URL = "https://webapi.microvix.com.br/1.0/api/integracao"
headers = {"Content-Type": "application/xml; charset=utf-8", "Accept": "application/xml"}
auth = HTTPBasicAuth(USUARIO, SENHA)

# 🔥 CAMINHO DO BANCO DE DADOS
PASTA_DB = r"C:\Users\Usuario\Desktop\TeleFluxo_Instalador\database"
NOME_DB = "samsung_vendas.db"
CAMINHO_FINAL_DB = os.path.join(PASTA_DB, NOME_DB)

# Garante que a pasta existe
if not os.path.exists(PASTA_DB):
    try:
        os.makedirs(PASTA_DB)
    except:
        pass

CNPJS = [
    "12309173001732","12309173001066","12309173001651","12309173000841","12309173001813",
    "12309173000507","12309173000175","12309173000337","12309173000922","12309173000256",
    "12309173001228","12309173000760","12309173001309","12309173001147","12309173000680",
    "12309173000418","12309173002461","12309173002208","12309173001570","12309173001902",
    "12309173002119","12309173002038","12309173002380","12309173002542","12309173002895",
    "12309173002976",
]

# === LOG ===
def setup_logger():
    log_dir = "logs"
    if not os.path.exists(log_dir): os.makedirs(log_dir)
    log_path = os.path.join(log_dir, "log_execucao.txt")
    logger = logging.getLogger("vendas")
    logger.setLevel(logging.INFO)
    if not logger.handlers:
        fh = logging.FileHandler(log_path, encoding="utf-8")
        fh.setFormatter(logging.Formatter('%(asctime)s %(message)s'))
        logger.addHandler(fh)
        logger.addHandler(logging.StreamHandler())
    return logger

logger = setup_logger()

# === FUNÇÕES AUXILIARES ===
def montar_xml(cnpj, metodo):
    hoje = datetime.now().strftime("%Y-%m-%d")
    params = f'<Parameter id="chave">{CHAVE}</Parameter><Parameter id="cnpjEmp">{cnpj}</Parameter><Parameter id="data_inicial">{hoje}</Parameter><Parameter id="data_fim">{hoje}</Parameter><Parameter id="hora_inicial">00:00</Parameter><Parameter id="hora_fim">23:59</Parameter>'
    return f'<?xml version="1.0" encoding="utf-8"?><LinxMicrovix><Authentication user="{USUARIO}" password="{SENHA}" /><ResponseFormat>xml</ResponseFormat><Command><Name>{metodo}</Name><Parameters>{params}</Parameters></Command></LinxMicrovix>'

def chamar_api(cnpj, metodo):
    try:
        r = requests.post(URL, data=montar_xml(cnpj, metodo).encode("utf-8"), headers=headers, auth=auth, timeout=120)
        if r.status_code != 200: return pd.DataFrame()
        root = etree.fromstring(r.content)
        cols = [d.text for d in root.xpath(".//C[last()]/D") if d.text]
        rows = root.xpath(".//R")
        data = [dict(zip(cols, [d.text for d in rr.xpath('./D')])) for rr in rows]
        return pd.DataFrame(data)
    except:
        return pd.DataFrame()

# === LÓGICA DE NEGÓCIO (SUBSTITUI EXCEL) ===
def aplicar_regras(df):
    logger.info("Aplicando fórmulas de negócio...")
    
    # --- CORREÇÃO DO ERRO KEYERROR: 'DESCRICAO' ---
    # Verifica se as colunas essenciais existem. Se não, cria vazias para não travar.
    colunas_essenciais = ['DESCRICAO', 'NOME_FANTASIA', 'NOME_VENDEDOR']
    for col in colunas_essenciais:
        if col not in df.columns:
            df[col] = "N/D" # Preenche com valor padrão se a API não retornar
            
    df['DATA_EMISSAO_DT'] = pd.to_datetime(df['DATA_EMISSAO'], dayfirst=True, errors='coerce')
    
    # Classificar Família (Coluna T do Excel)
    df['FAMILIA'] = "OUTROS"
    df['DESCRICAO'] = df['DESCRICAO'].astype(str).str.upper() # Agora seguro pois a coluna existe
    
    df.loc[df['DESCRICAO'].str.contains("S25"), 'FAMILIA'] = "GALAXY S25"
    df.loc[df['DESCRICAO'].str.contains("S24"), 'FAMILIA'] = "GALAXY S24"
    df.loc[df['DESCRICAO'].str.contains("FLIP"), 'FAMILIA'] = "Z FLIP"
    df.loc[df['DESCRICAO'].str.contains("FOLD"), 'FAMILIA'] = "Z FOLD"
    
    return df

# === EXECUÇÃO ===
todos = []
logger.info("Iniciando extração...")

for cnpj in CNPJS:
    logger.info(f"CNPJ: {cnpj}")
    df = chamar_api(cnpj, "LinxMovimento")
    if not df.empty:
        df.columns = [c.upper() for c in df.columns]
        todos.append(df)
    time.sleep(1) # Respeita limite da API

if todos:
    df_final = pd.concat(todos, ignore_index=True)
    
    # Renomear colunas para o padrão do nosso banco
    rename_map = {
        "DOCUMENTO": "NOTA_FISCAL", 
        "DATA_DOCUMENTO": "DATA_EMISSAO", 
        "VALOR_LIQUIDO": "TOTAL_LIQUIDO",
        "VENDEDOR_NOME": "NOME_VENDEDOR" # Tenta mapear nomes comuns
    }
    df_final.rename(columns=rename_map, inplace=True)
    
    # Tratamento Numérico
    for c in ["TOTAL_LIQUIDO", "QUANTIDADE"]:
        if c in df_final.columns:
            df_final[c] = pd.to_numeric(df_final[c].astype(str).str.replace(",", "."), errors="coerce").fillna(0)
    
    # Tratamento Data
    if "DATA_EMISSAO" in df_final.columns:
        dates = pd.to_datetime(df_final["DATA_EMISSAO"], errors="coerce")
        df_final["DATA_EMISSAO"] = dates.dt.strftime("%d/%m/%Y")

    # Aplica regras (COM CORREÇÃO DE ERRO)
    df_final = aplicar_regras(df_final)

    # Salva no Banco
    conn = sqlite3.connect(CAMINHO_FINAL_DB)
    hoje_str = datetime.now().strftime("%d/%m/%Y")
    
    try:
        # Tenta limpar o dia atual para evitar duplicidade
        conn.execute("DELETE FROM vendas WHERE DATA_EMISSAO = ?", (hoje_str,))
        conn.commit()
    except: 
        pass # Tabela não existe ainda, normal
    
    df_final.to_sql("vendas", conn, if_exists="append", index=False)
    conn.close()
    
    print(f"\n✅ SUCESSO! Banco atualizado em: {CAMINHO_FINAL_DB}")
    print(f"Total de registros processados: {len(df_final)}")
else:
    print("\n⚠️ Nenhum dado encontrado hoje nos CNPJs consultados.")
    # Cria um banco vazio só para o site não dar erro na primeira vez
    conn = sqlite3.connect(CAMINHO_FINAL_DB)
    pd.DataFrame(columns=["TOTAL_LIQUIDO", "QUANTIDADE", "DATA_EMISSAO", "NOME_VENDEDOR", "DESCRICAO"]).to_sql("vendas", conn, if_exists="append", index=False)
    conn.close()
    print("Banco vazio criado para inicialização.")