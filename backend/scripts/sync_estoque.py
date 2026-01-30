# ===========================================
# 📦 SINCRONIZADOR DE ESTOQUE v6.0 (FUSÃO PERFEITA)
# ===========================================

import requests
from requests.auth import HTTPBasicAuth
from lxml import etree
import pandas as pd
from datetime import datetime, timedelta
import os
import sys
import time
import json

# --- CONFIGURAÇÃO ---
API_ENDPOINT = "http://localhost:3000/stock/sync"

# === CREDENCIAIS MICROVIX ===
USUARIO = "linx_export"
SENHA   = "linx_export"
CHAVE   = "2618f2b2-8f1d-4502-8321-342dc2cd1470"
URL     = "https://webapi.microvix.com.br/1.0/api/integracao"

# CNPJ PRINCIPAL PARA O CONTEXTO DO CATÁLOGO (Usando o primeiro da lista)
CNPJ_CONTEXTO = "12309173001309" 

headers = {"Content-Type": "application/xml; charset=utf-8", "Accept": "application/xml"}
auth    = HTTPBasicAuth(USUARIO, SENHA)

# === 🏪 MAPEAMENTO DE LOJAS ===
LOJAS_NOME = {
    "12309173001309": "ARAGUAIA SHOPPING",
    "12309173000418": "BOULEVARD SHOPPING",
    "12309173000175": "BRASILIA SHOPPING",
    "12309173000680": "CONJUNTO NACIONAL",
    "12309173001228": "CONJUNTO NACIONAL QUIOSQUE",
    "12309173000507": "GOIANIA SHOPPING",
    "12309173000256": "IGUATEMI SHOPPING",
    "12309173000841": "JK SHOPPING",
    "12309173000337": "PARK SHOPPING",
    "12309173000922": "PATIO BRASIL",
    "12309173000760": "TAGUATINGA SHOPPING",
    "12309173001147": "TERRAÇO SHOPPING",
    "12309173001651": "TAGUATINGA SHOPPING QQ",
    "12309173001732": "UBERLÂNDIA SHOPPING",
    "12309173001813": "UBERABA SHOPPING",
    "12309173001570": "FLAMBOYANT SHOPPING",
    "12309173002119": "BURITI SHOPPING",
    "12309173002461": "PASSEIO DAS AGUAS",
    "12309173002038": "PORTAL SHOPPING",
    "12309173002208": "SHOPPING SUL",
    "12309173001902": "BURITI RIO VERDE",
    "12309173002380": "PARK ANAPOLIS",
    "12309173002542": "SHOPPING RECIFE",
    "12309173002895": "MANAIRA SHOPPING",
    "12309173002976": "IGUATEMI FORTALEZA",
    "12309173001066": "CD TAGUATINGA"
}
CNPJS = list(LOJAS_NOME.keys())
JANELA_DIAS_MOV = 365

# ===========================================
# 🛠️ FUNÇÕES AUXILIARES
# ===========================================
def log(msg): print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}")
def iso(d): return d.strftime("%Y-%m-%d")

def to_float(series):
    return pd.to_numeric(
        pd.Series(series, dtype="object").astype(str).str.replace(",", ".", regex=False).str.replace(r"[^\d\.\-]", "", regex=True),
        errors="coerce"
    ).fillna(0)

# ===========================================
# 1. EXTRAÇÃO DE CADASTRO (LÓGICA DO SEU CÓDIGO)
# ===========================================
def chamar_api_catalogo(dt_ini, dt_fim):
    # AQUI ESTAVA O ERRO: Faltava o cnpjEmp! Agora adicionei.
    xml = f"""<?xml version="1.0" encoding="utf-8"?>
    <LinxMicrovix>
      <Authentication user="{USUARIO}" password="{SENHA}" />
      <ResponseFormat>xml</ResponseFormat>
      <Command>
        <Name>LinxProdutos</Name>
        <Parameters>
          <Parameter id="chave">{CHAVE}</Parameter>
          <Parameter id="cnpjEmp">{CNPJ_CONTEXTO}</Parameter>
          <Parameter id="dt_update_inicio">{dt_ini}</Parameter>
          <Parameter id="dt_update_fim">{dt_fim}</Parameter>
        </Parameters>
      </Command>
    </LinxMicrovix>"""
    
    try:
        r = requests.post(URL, data=xml.encode("utf-8"), headers=headers, auth=auth, timeout=300)
        if r.status_code != 200: return None
        
        root = etree.fromstring(r.content)
        success = root.xpath(".//ResponseSuccess/text()")
        if success and success[0].lower() == "false":
            return None
            
        cols = [d.text for d in root.xpath(".//C[last()]/D")]
        rows = root.xpath(".//R")
        data = [dict(zip(cols, [d.text for d in rr.xpath('./D')])) for rr in rows]
        return pd.DataFrame(data)
    except:
        return None

def baixar_intervalo_recursivo(dt_ini, dt_fim):
    """ Lógica recursiva: Se lotar (>4900), divide o tempo ao meio """
    df = chamar_api_catalogo(dt_ini, dt_fim)
    if df is None: return pd.DataFrame()

    qtd = len(df)
    
    # Se bateu no teto (API limita em 5000), divide ao meio
    if qtd >= 4900: 
        # Converte para datetime para calcular o meio
        dt_ini_dt = datetime.combine(dt_ini, datetime.min.time()) if isinstance(dt_ini, datetime) else datetime.strptime(str(dt_ini), "%Y-%m-%d")
        dt_fim_dt = datetime.combine(dt_fim, datetime.min.time()) if isinstance(dt_fim, datetime) else datetime.strptime(str(dt_fim), "%Y-%m-%d")
        
        # Calcula meio
        meio_dt = dt_ini_dt + (dt_fim_dt - dt_ini_dt) / 2
        meio = meio_dt.date()
        
        log(f"🔁 Dividindo intervalo cheio: {dt_ini} -> {meio} -> {dt_fim}")
        
        df1 = baixar_intervalo_recursivo(dt_ini, meio)
        df2 = baixar_intervalo_recursivo(meio, dt_fim)
        return pd.concat([df1, df2], ignore_index=True)
    
    # Se não lotou, retorna o que achou
    if qtd > 0:
        log(f"   📅 {dt_ini} a {dt_fim}: {qtd} produtos.")
        
    return df

def extrair_catalogo_completo():
    log("📚 Iniciando download do catálogo (Lógica Recursiva)...")
    
    # Data de corte segura (2015 para cá é suficiente para produtos ativos, ou use 2000 se quiser tudo)
    inicio = datetime(2015, 1, 1).date() 
    fim = datetime.now().date()
    
    df = baixar_intervalo_recursivo(inicio, fim)
    
    if df.empty:
        return pd.DataFrame()
        
    df.columns = [c.lower() for c in df.columns]
    
    # Remove duplicatas (mantendo a versão mais recente do produto)
    if "cod_produto" in df.columns:
        df["cod_produto"] = pd.to_numeric(df["cod_produto"], errors="coerce")
        df = df.drop_duplicates(subset=["cod_produto"], keep='last')
    
    # Mapeamento
    df["NOME_REAL"] = None
    for c in ["nome_produto", "descricao_basica", "nome", "desc_produto"]:
        if c in df.columns:
            df["NOME_REAL"] = df[c].fillna(df["NOME_REAL"])
            break

    df["REF_REAL"] = None
    if "referencia" in df.columns: df["REF_REAL"] = df["referencia"]
    
    df["CAT_REAL"] = "GERAL"
    for c in ["desc_setor", "nome_setor", "setor", "categoria"]:
        if c in df.columns:
            df["CAT_REAL"] = df[c].fillna(df["CAT_REAL"])
            break

    df.rename(columns={"cod_produto": "CODIGO_PRODUTO"}, inplace=True)
    
    # Garante colunas finais
    final_cols = ["CODIGO_PRODUTO", "NOME_REAL", "REF_REAL", "CAT_REAL"]
    for c in final_cols:
        if c not in df.columns: df[c] = "-"
        
    return df[final_cols]

# ===========================================
# 2. EXTRAÇÃO DE ESTOQUE (MANTIDO O QUE JÁ FUNCIONAVA)
# ===========================================
def chamar_api_detalhes(parametros):
    params_xml = "".join([f'<Parameter id="{k}">{v}</Parameter>' for k,v in parametros.items()])
    xml = f"""<?xml version="1.0" encoding="utf-8"?>
    <LinxMicrovix>
      <Authentication user="{USUARIO}" password="{SENHA}" />
      <ResponseFormat>xml</ResponseFormat>
      <Command>
        <Name>LinxProdutosDetalhes</Name>
        <Parameters><Parameter id="chave">{CHAVE}</Parameter>{params_xml}</Parameters>
      </Command>
    </LinxMicrovix>"""
    try:
        r = requests.post(URL, data=xml.encode("utf-8"), headers=headers, auth=auth, timeout=120)
        if r.status_code != 200: return pd.DataFrame()
        root = etree.fromstring(r.content)
        cols = [d.text for d in root.xpath(".//C[last()]/D")]
        rows = root.xpath(".//R")
        data = [dict(zip(cols, [d.text for d in rr.xpath('./D')])) for rr in rows]
        return pd.DataFrame(data)
    except: return pd.DataFrame()

def extrair_estoque(cnpj):
    hoje = datetime.now().date()
    mov_ini = hoje - timedelta(days=JANELA_DIAS_MOV)
    
    dfs = []
    ts = 0
    teve_retorno = False

    while True:
        params = {"cnpjEmp": cnpj, "data_mov_ini": iso(mov_ini), "data_mov_fim": iso(hoje), "timestamp": str(ts)}
        df = chamar_api_detalhes(params)
        if df.empty: break
        
        teve_retorno = True
        df.columns = [c.lower() for c in df.columns]
        dfs.append(df)
        try: ts = int(pd.to_numeric(df.get("timestamp"), errors="coerce").max())
        except: break
        time.sleep(0.1)

    if not teve_retorno:
        ts = 0
        while True:
            params = {"cnpjEmp": cnpj, "timestamp": str(ts), "retornar_saldo_zero": "1"}
            df = chamar_api_detalhes(params)
            if df.empty: break
            df.columns = [c.lower() for c in df.columns]
            dfs.append(df)
            try: ts = int(pd.to_numeric(df.get("timestamp"), errors="coerce").max())
            except: break
            time.sleep(0.1)

    if not dfs: return pd.DataFrame()
    base = pd.concat(dfs, ignore_index=True)
    if "timestamp" in base.columns: base = base.sort_values("timestamp", ascending=False)
    base = base.drop_duplicates(subset=["cod_produto"])
    
    base["CNPJ_ORIGEM"] = cnpj
    base["NOME_FANTASIA"] = LOJAS_NOME.get(cnpj, f"LOJA {cnpj[-4:]}")

    rename_map = {"cod_produto": "CODIGO_PRODUTO", "quantidade": "QUANTIDADE", "preco_custo": "PRECO_CUSTO", "preco_venda": "PRECO_VENDA", "custo_medio": "CUSTO_MEDIO"}
    base.rename(columns=rename_map, inplace=True)
    return base

# ===========================================
# ▶ EXECUÇÃO PRINCIPAL
# ===========================================
def main():
    log("🚀 Iniciando Sincronização v6.0 (Fusão Completa)...")

    # 1. Catálogo
    catalogo = extrair_catalogo_completo()
    
    if catalogo.empty:
        log("⚠️ ERRO: Catálogo vazio. Verifique se o CNPJ de contexto está correto.")
        return 
        
    log(f"✅ Catálogo OK: {len(catalogo)} produtos carregados.")

    # 2. Estoque
    todos_dados = []
    for i, cnpj in enumerate(CNPJS):
        log(f"[{i+1}/{len(CNPJS)}] CNPJ: {cnpj}...")
        df = extrair_estoque(cnpj)
        if not df.empty: todos_dados.append(df)
    
    if not todos_dados:
        log("❌ Nenhum estoque encontrado.")
        return

    df_final = pd.concat(todos_dados, ignore_index=True)

    # 3. Cruzamento
    log("🔄 Unificando dados...")
    
    # Normaliza chaves para o merge (inteiro para evitar problema de string '01' vs '1')
    df_final["CODIGO_PRODUTO"] = pd.to_numeric(df_final["CODIGO_PRODUTO"], errors="coerce")
    catalogo["CODIGO_PRODUTO"] = pd.to_numeric(catalogo["CODIGO_PRODUTO"], errors="coerce")
    
    df_final = df_final.merge(catalogo, on="CODIGO_PRODUTO", how="left")
    
    # Preenchimento
    df_final["DESCRICAO"] = df_final["NOME_REAL"].fillna("PRODUTO S/ CADASTRO")
    df_final["REFERENCIA"] = df_final["REF_REAL"].fillna("-")
    df_final["CATEGORIA"] = df_final["CAT_REAL"].fillna("GERAL")

    for col in ["QUANTIDADE", "PRECO_CUSTO", "PRECO_VENDA", "CUSTO_MEDIO"]:
        df_final[col] = to_float(df_final.get(col, 0))

    # 4. Envio
    log("📡 Enviando para o TeleFluxo...")
    records = df_final.to_dict(orient="records")
    clean_records = []
    for row in records:
        clean_row = {}
        for k, v in row.items():
            if pd.isna(v): clean_row[k] = 0 if "PRECO" in k or "QUANTIDADE" in k else ""
            else: clean_row[k] = v
        
        if clean_row.get("QUANTIDADE", 0) > 0:
            clean_records.append(clean_row)

    try:
        log(f"📦 Enviando {len(clean_records)} itens...")
        r = requests.post(API_ENDPOINT, json=clean_records)
        if r.status_code in [200, 201]: log("✅ SUCESSO! Sistema atualizado.")
        else: log(f"⚠️ Erro envio: {r.status_code} - {r.text}")
    except Exception as e:
        log(f"❌ Erro conexão: {e}")

if __name__ == "__main__":
    main()