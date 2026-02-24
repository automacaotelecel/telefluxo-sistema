# ===========================================
# 📦 SINCRONIZADOR DE ESTOQUE v8.0 (COM EXTRAÇÃO DE IMEI/SERIAL)
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
import sqlite3 
import uuid    

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
    "12309173001309": "ARAGUAIA SHOPPING", "12309173000418": "BOULEVARD SHOPPING",
    "12309173000175": "BRASILIA SHOPPING", "12309173000680": "CONJUNTO NACIONAL",
    "12309173001228": "CONJUNTO NACIONAL QUIOSQUE", "12309173000507": "GOIANIA SHOPPING",
    "12309173000256": "IGUATEMI SHOPPING", "12309173000841": "JK SHOPPING",
    "12309173000337": "PARK SHOPPING", "12309173000922": "PATIO BRASIL",
    "12309173000760": "TAGUATINGA SHOPPING", "12309173001147": "TERRAÇO SHOPPING",
    "12309173001651": "TAGUATINGA SHOPPING QQ", "12309173001732": "UBERLÂNDIA SHOPPING",
    "12309173001813": "UBERABA SHOPPING", "12309173001570": "FLAMBOYANT SHOPPING",
    "12309173002119": "BURITI SHOPPING", "12309173002461": "PASSEIO DAS AGUAS",
    "12309173002038": "PORTAL SHOPPING", "12309173002208": "SHOPPING SUL",
    "12309173001902": "BURITI RIO VERDE", "12309173002380": "PARK ANAPOLIS",
    "12309173002542": "SHOPPING RECIFE", "12309173002895": "MANAIRA SHOPPING",
    "12309173002976": "IGUATEMI FORTALEZA", "12309173001066": "CD TAGUATINGA"
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
# 1. EXTRAÇÃO DE CADASTRO (LINX PRODUTOS)
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
        if success and success[0].lower() == "false": return None
        cols = [d.text for d in root.xpath(".//C[last()]/D")]
        rows = root.xpath(".//R")
        data = [dict(zip(cols, [d.text for d in rr.xpath('./D')])) for rr in rows]
        return pd.DataFrame(data)
    except: return None

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
    if qtd > 0: log(f"   📅 {dt_ini} a {dt_fim}: {qtd} produtos.")
    return df

def extrair_catalogo_completo():
    log("📚 Iniciando download do catálogo...")
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

    df["REF_REAL"] = df["referencia"] if "referencia" in df.columns else None
    
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
# 2. EXTRAÇÃO DE ESTOQUE AGREGADO
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
    base.rename(columns={"cod_produto": "CODIGO_PRODUTO", "quantidade": "QUANTIDADE", "preco_custo": "PRECO_CUSTO", "preco_venda": "PRECO_VENDA", "custo_medio": "CUSTO_MEDIO"}, inplace=True)
    return base

# ===========================================
# 3. EXTRAÇÃO DE SERIAIS (IMEI) - NOVIDADE!
# ===========================================
def chamar_api_seriais(parametros):
    params_xml = "".join([f'<Parameter id="{k}">{v}</Parameter>' for k,v in parametros.items()])
    xml = f"""<?xml version="1.0" encoding="utf-8"?>
    <LinxMicrovix>
      <Authentication user="{USUARIO}" password="{SENHA}" />
      <ResponseFormat>xml</ResponseFormat>
      <Command>
        <Name>LinxProdutosSerial</Name>
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

def extrair_seriais_loja(cnpj):
    dfs = []
    ts = 0
    while True:
        params = {"cnpjEmp": cnpj, "timestamp": str(ts)}
        df = chamar_api_seriais(params)
        if df.empty: break
        df.columns = [c.lower() for c in df.columns]
        
        # Filtra apenas IMEIs que estão efetivamente em estoque (saldo = True ou 1)
        if 'saldo' in df.columns:
            df = df[df['saldo'].astype(str).str.lower().isin(['true', '1', 's', 'sim', '1.0'])]
            
        dfs.append(df)
        try: ts = int(pd.to_numeric(df.get("timestamp"), errors="coerce").max())
        except: break
        time.sleep(0.1)

    if not dfs: return pd.DataFrame()
    base = pd.concat(dfs, ignore_index=True)
    if "timestamp" in base.columns: base = base.sort_values("timestamp", ascending=False)
    base = base.drop_duplicates(subset=["serial"]) # Garante 1 registro por IMEI
    base["CNPJ_ORIGEM"] = cnpj
    return base

# ===========================================
# 4. SALVAR NA NUVEM VIA API (EM LOTES)
# ===========================================
def enviar_para_api(dataframe):
    base_url = "https://telefluxo-aplicacao.onrender.com/stock/sync"
    
    # Previne erros de JSON
    dataframe = dataframe.where(pd.notnull(dataframe), None)
    dados_completos = dataframe.to_dict(orient="records")
    
    # Divide os 18.000 itens em pacotes de 500 (Tamanho perfeito pro Render)
    BATCH_SIZE = 100
    total_lotes = (len(dados_completos) // BATCH_SIZE) + 1
    log(f"📡 Preparando envio de {len(dados_completos)} registros em {total_lotes} lotes...")

    headers = {"Content-Type": "application/json"}

    for i in range(0, len(dados_completos), BATCH_SIZE):
        lote = dados_completos[i : i + BATCH_SIZE]
        lote_num = (i // BATCH_SIZE) + 1
        
        # O primeiro lote apaga o banco, os outros apenas empilham os dados
        param_reset = "true" if i == 0 else "false"
        url_lote = f"{base_url}?reset={param_reset}"

        log(f"   📦 Enviando Lote {lote_num}/{total_lotes}...")
        
        for attempt in range(1, 6): # Tenta até 5 vezes se o servidor piscar
            try:
                response = requests.post(url_lote, json=lote, headers=headers, timeout=120)
                if 200 <= response.status_code < 300:
                    time.sleep(0.5) # Dá um respiro de meio segundo para a memória do Render
                    break
                else:
                    log(f"      ⚠️ Erro no Lote {lote_num} (Tentativa {attempt}): {response.status_code}")
                    time.sleep(5)
            except Exception as e:
                log(f"      ⚠️ Falha de Conexão no Lote {lote_num} (Tentativa {attempt}): {e}")
                time.sleep(5)
        else:
            log(f"❌ Desistindo do Lote {lote_num} após várias tentativas.")
            return False
            
    log("✅ Sucesso Absoluto! Estoque e IMEIs atualizados na Produção.")
    return True

# ===========================================
# ▶ EXECUÇÃO PRINCIPAL
# ===========================================
def main():
    log("🚀 Iniciando Sincronização v8.0 (Auditoria com IMEI)...")

    # 1. Catálogo
    catalogo = extrair_catalogo_completo()
    if catalogo.empty:
        log("⚠️ ERRO: Catálogo vazio.")
        return 
    log(f"✅ Catálogo OK: {len(catalogo)} produtos carregados.")

    # 2. Estoque Agregado e Seriais
    todos_dados = []
    todos_seriais = []
    
    for i, cnpj in enumerate(CNPJS):
        log(f"[{i+1}/{len(CNPJS)}] CNPJ: {cnpj}...")
        
        # Puxa o estoque agregado (quantidades)
        df_est = extrair_estoque(cnpj)
        if not df_est.empty: todos_dados.append(df_est)
            
        # Puxa os IMEIs
        df_ser = extrair_seriais_loja(cnpj)
        if not df_ser.empty: todos_seriais.append(df_ser)
    
    if not todos_dados:
        log("❌ Nenhum estoque encontrado.")
        return

    df_estoque = pd.concat(todos_dados, ignore_index=True)
    df_seriais = pd.concat(todos_seriais, ignore_index=True) if todos_seriais else pd.DataFrame(columns=["CNPJ_ORIGEM", "codigoproduto", "serial"])

    # 3. Cruzamento Estoque x Catálogo
    log("🔄 Unificando dados de Catálogo...")
    df_estoque["CODIGO_PRODUTO"] = pd.to_numeric(df_estoque["CODIGO_PRODUTO"], errors="coerce")
    catalogo["CODIGO_PRODUTO"] = pd.to_numeric(catalogo["CODIGO_PRODUTO"], errors="coerce")
    df_seriais["codigoproduto"] = pd.to_numeric(df_seriais["codigoproduto"], errors="coerce")
    
    df_estoque = df_estoque.merge(catalogo, on="CODIGO_PRODUTO", how="left")
    df_estoque["DESCRICAO"] = df_estoque["NOME_REAL"].fillna("PRODUTO S/ CADASTRO")
    df_estoque["REFERENCIA"] = df_estoque["REF_REAL"].fillna("-")
    df_estoque["CATEGORIA"] = df_estoque["CAT_REAL"].fillna("GERAL")

    for col in ["QUANTIDADE", "PRECO_CUSTO", "PRECO_VENDA", "CUSTO_MEDIO"]:
        df_estoque[col] = to_float(df_estoque.get(col, 0))

    # 4. A MÁGICA: DESDOBRAMENTO POR IMEI
    log("🔍 Desdobrando itens com IMEI...")
    linhas_expandidas = []
    
    for _, row in df_estoque.iterrows():
        cnpj = row["CNPJ_ORIGEM"]
        cod = row["CODIGO_PRODUTO"]
        qtd_total = float(row["QUANTIDADE"])

        # Procura se esse produto nessa loja tem IMEIs atrelados
        seriais_produto = df_seriais[
            (df_seriais["CNPJ_ORIGEM"] == cnpj) & 
            (df_seriais["codigoproduto"] == cod)
        ]["serial"].tolist()

        if len(seriais_produto) > 0:
            # Aparelho com IMEI encontrado! Quebra em 1 linha para cada IMEI
            for s in seriais_produto:
                nova_linha = row.copy()
                nova_linha["QUANTIDADE"] = 1.0 # Cada IMEI é 1 unidade
                nova_linha["SERIAL"] = str(s).strip()
                linhas_expandidas.append(nova_linha)
            
            # Se o sistema diz que tem 5, mas só achou 4 IMEIs, cria uma linha pro restante
            if qtd_total > len(seriais_produto):
                nova_linha = row.copy()
                nova_linha["QUANTIDADE"] = qtd_total - len(seriais_produto)
                nova_linha["SERIAL"] = ""
                linhas_expandidas.append(nova_linha)
        else:
            # Acessórios (ou itens sem IMEI) ficam na mesma linha somada
            nova_linha = row.copy()
            nova_linha["SERIAL"] = ""
            linhas_expandidas.append(nova_linha)

    df_final = pd.DataFrame(linhas_expandidas)

    # 5. SALVAMENTO DIRETO 
    log("💾 Disparando dados com IMEIs para a API da Produção...")
    enviar_para_api(df_final)

if __name__ == "__main__":
    main()