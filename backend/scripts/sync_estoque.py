# ===========================================
# 📦 SINCRONIZADOR DE ESTOQUE v7.0 (DIRETO NO SQLITE dev.db)
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
import sqlite3 # Adicionado para conexão direta
import uuid    # Adicionado para gerar IDs únicos

# --- CONFIGURAÇÃO ---
# A URL foi removida pois vamos gravar direto no arquivo

# === CREDENCIAIS MICROVIX ===
USUARIO = "linx_export"
SENHA   = "linx_export"
CHAVE   = "2618f2b2-8f1d-4502-8321-342dc2cd1470"
URL     = "https://webapi.microvix.com.br/1.0/api/integracao"

# CNPJ PRINCIPAL PARA O CONTEXTO DO CATÁLOGO
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
# 1. EXTRAÇÃO DE CADASTRO
# ===========================================
def chamar_api_catalogo(dt_ini, dt_fim):
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
    df = chamar_api_catalogo(dt_ini, dt_fim)
    if df is None: return pd.DataFrame()

    qtd = len(df)
    if qtd >= 4900: 
        dt_ini_dt = datetime.combine(dt_ini, datetime.min.time()) if isinstance(dt_ini, datetime) else datetime.strptime(str(dt_ini), "%Y-%m-%d")
        dt_fim_dt = datetime.combine(dt_fim, datetime.min.time()) if isinstance(dt_fim, datetime) else datetime.strptime(str(dt_fim), "%Y-%m-%d")
        meio_dt = dt_ini_dt + (dt_fim_dt - dt_ini_dt) / 2
        meio = meio_dt.date()
        log(f"🔁 Dividindo intervalo cheio: {dt_ini} -> {meio} -> {dt_fim}")
        df1 = baixar_intervalo_recursivo(dt_ini, meio)
        df2 = baixar_intervalo_recursivo(meio, dt_fim)
        return pd.concat([df1, df2], ignore_index=True)
    
    if qtd > 0:
        log(f"   📅 {dt_ini} a {dt_fim}: {qtd} produtos.")
    return df

def extrair_catalogo_completo():
    log("📚 Iniciando download do catálogo (Lógica Recursiva)...")
    inicio = datetime(2015, 1, 1).date() 
    fim = datetime.now().date()
    df = baixar_intervalo_recursivo(inicio, fim)
    
    if df.empty: return pd.DataFrame()
    df.columns = [c.lower() for c in df.columns]
    
    if "cod_produto" in df.columns:
        df["cod_produto"] = pd.to_numeric(df["cod_produto"], errors="coerce")
        df = df.drop_duplicates(subset=["cod_produto"], keep='last')
    
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
    final_cols = ["CODIGO_PRODUTO", "NOME_REAL", "REF_REAL", "CAT_REAL"]
    for c in final_cols:
        if c not in df.columns: df[c] = "-"
        
    return df[final_cols]

# ===========================================
# 2. EXTRAÇÃO DE ESTOQUE
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
# 3. SALVAR DIRETO NO SQLITE (dev.db)
# ===========================================
def salvar_no_sqlite_direto(dataframe):
    # Calcula o caminho absoluto para prisma/dev.db
    # O script está em backend/scripts/
    base_dir = os.path.dirname(os.path.abspath(__file__))
    # Sobe para backend/ e entra em prisma/dev.db
    db_path = os.path.join(base_dir, '..', 'prisma', 'dev.db')
    
    log(f"📍 Conectando diretamente ao banco: {db_path}")
    
    try:
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()
        
        # Garante que a tabela Stock existe (Schema do Prisma)
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS Stock (
                id TEXT PRIMARY KEY,
                cnpj TEXT NOT NULL,
                storeName TEXT NOT NULL,
                productCode TEXT NOT NULL,
                reference TEXT,
                description TEXT NOT NULL,
                category TEXT,
                quantity REAL NOT NULL,
                costPrice REAL NOT NULL,
                salePrice REAL,
                averageCost REAL,
                updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        
        # Limpa o estoque antigo
        cursor.execute("DELETE FROM Stock")
        log("🗑️ Estoque antigo limpo no banco.")
        
        # Prepara os dados para inserção
        rows_to_insert = []
        now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        
        count = 0
        for _, row in dataframe.iterrows():
            if row.get("QUANTIDADE", 0) != 0: # Salva apenas o que tem movimento/estoque
                count += 1
                rows_to_insert.append((
                    str(uuid.uuid4()),                  # id
                    str(row["CNPJ_ORIGEM"]),            # cnpj
                    str(row["NOME_FANTASIA"]),          # storeName
                    str(row["CODIGO_PRODUTO"]),         # productCode
                    str(row.get("REFERENCIA", "-")),    # reference
                    str(row.get("DESCRICAO", "S/D")),   # description
                    str(row.get("CATEGORIA", "GERAL")), # category
                    float(row.get("QUANTIDADE", 0)),    # quantity
                    float(row.get("PRECO_CUSTO", 0)),   # costPrice
                    float(row.get("PRECO_VENDA", 0)),   # salePrice
                    float(row.get("CUSTO_MEDIO", 0)),   # averageCost
                    now_str                             # updatedAt
                ))
        
        # Executa insert em massa
        cursor.executemany('''
            INSERT INTO Stock (id, cnpj, storeName, productCode, reference, description, category, quantity, costPrice, salePrice, averageCost, updatedAt)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ''', rows_to_insert)
        
        conn.commit()
        log(f"💾 {count} itens inseridos com sucesso no arquivo dev.db!")
        conn.close()
        return True

    except Exception as e:
        log(f"❌ ERRO CRÍTICO AO SALVAR NO SQLITE: {e}")
        return False

# ===========================================
# ▶ EXECUÇÃO PRINCIPAL
# ===========================================
def main():
    log("🚀 Iniciando Sincronização v7.0 (Direct DB Injection)...")

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
    df_final["CODIGO_PRODUTO"] = pd.to_numeric(df_final["CODIGO_PRODUTO"], errors="coerce")
    catalogo["CODIGO_PRODUTO"] = pd.to_numeric(catalogo["CODIGO_PRODUTO"], errors="coerce")
    
    df_final = df_final.merge(catalogo, on="CODIGO_PRODUTO", how="left")
    
    df_final["DESCRICAO"] = df_final["NOME_REAL"].fillna("PRODUTO S/ CADASTRO")
    df_final["REFERENCIA"] = df_final["REF_REAL"].fillna("-")
    df_final["CATEGORIA"] = df_final["CAT_REAL"].fillna("GERAL")

    for col in ["QUANTIDADE", "PRECO_CUSTO", "PRECO_VENDA", "CUSTO_MEDIO"]:
        df_final[col] = to_float(df_final.get(col, 0))

    # 4. SALVAMENTO DIRETO (SUBSTITUI O ENVIO API)
    log("💾 Gravando diretamente no Banco Unificado...")
    salvar_no_sqlite_direto(df_final)

if __name__ == "__main__":
    main()