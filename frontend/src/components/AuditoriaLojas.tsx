import React, { useState, useEffect } from 'react';
import { 
  Store, UploadCloud, CheckCircle, AlertTriangle, XCircle, Search, 
  ArrowLeft, FileSpreadsheet, Layers, Smartphone, RefreshCw, Download, Target, BarChart2
} from 'lucide-react';
import * as XLSX from 'xlsx';

// Mapa de Lojas e Regiões 
const REGIOES = {
  "DF e Entorno": ["BRASILIA SHOPPING", "TAGUATINGA SHOPPING", "CONJUNTO NACIONAL", "PARK SHOPPING", "JK SHOPPING", "TERRAÇO SHOPPING", "PATIO BRASIL", "TAGUATINGA SHOPPING QQ", "CONJUNTO NACIONAL QUIOSQUE", "SHOPPING SUL"],
  "Goiás": ["GOIANIA SHOPPING", "FLAMBOYANT SHOPPING", "PASSEIO DAS AGUAS", "BURITI SHOPPING", "PORTAL SHOPPING", "BURITI RIO VERDE", "PARK ANAPOLIS", "ARAGUAIA SHOPPING", "BOULEVARD SHOPPING"],
  "Minas Gerais": ["UBERLÂNDIA SHOPPING", "UBERABA SHOPPING"],
  "Nordeste": ["SHOPPING RECIFE", "MANAIRA SHOPPING", "IGUATEMI FORTALEZA", "IGUATEMI SHOPPING"],
  "Centro de Distribuição": ["CD TAGUATINGA"]
};

export default function AuditoriaLojas() {
  const [stockRaw, setStockRaw] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedStore, setSelectedStore] = useState<string | null>(null);
  
  const [file, setFile] = useState<File | null>(null);
  const [auditResults, setAuditResults] = useState<any>(null);
  const [activeTab, setActiveTab] = useState<'bateu' | 'faltas' | 'sobras'>('faltas');

  const API_URL = window.location.hostname === 'localhost' || window.location.hostname.includes('.')
    ? `http://${window.location.hostname}:3000` 
    : 'https://telefluxo-aplicacao.onrender.com';

  const loadStock = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/stock`);
      if (res.ok) {
        const data = await res.json();
        setStockRaw(data);
      }
    } catch (e) {
      console.error("Erro ao carregar estoque:", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadStock(); }, []);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      setFile(e.target.files[0]);
      setAuditResults(null); 
    }
  };

  // --- FUNÇÕES DE LIMPEZA ---
  const limparImei = (val: any) => {
    if (!val) return '';
    let s = String(val).toUpperCase();
    s = s.split('.')[0]; 
    s = s.replace(/[\s\-]/g, ''); 
    return s;
  };

  const limparTexto = (val: any) => {
    if (!val) return '';
    return String(val).toUpperCase().replace(/\s+/g, ' ').trim(); 
  };

  // --- MOTOR DE CRUZAMENTO ---
  const validarAuditoria = () => {
    if (!file || !selectedStore) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const jsonFisico: any[] = XLSX.utils.sheet_to_json(sheet);

        const fisicoNormalizado = jsonFisico.map(row => {
          const colImei = row['IMEI'] || row['Imei'] || row['Série'] || row['SERIAL'] || row['IMEI/SERIAL'] || '';
          const colDesc = row['Descrição'] || row['Descricao'] || row['PRODUTO'] || row['Produto'] || 'Sem Descrição';
          const colQtd = row['Quantidade'] || row['Qtd'] || row['QTD'] || row['QUANTIDADE'] || 1;

          return {
            imei: limparImei(colImei),
            descricao: limparTexto(colDesc),
            qtd: Number(colQtd) || 1
          };
        });

        const sysStore = stockRaw.filter(s => String(s.storeName).toUpperCase().includes(selectedStore.toUpperCase()));
        
        const sysAparelhos = sysStore
          .filter(s => s.serial && limparImei(s.serial) !== '')
          .map(s => ({
            ...s,
            cleanSerial: limparImei(s.serial),
            cleanDesc: limparTexto(s.description)
          }));

        const sysAcessorios = sysStore
          .filter(s => !s.serial || limparImei(s.serial) === '')
          .map(s => ({
            ...s,
            cleanDesc: limparTexto(s.description)
          }));

        const physAparelhos = fisicoNormalizado.filter(p => p.imei !== '');
        const physAcessorios = fisicoNormalizado.filter(p => p.imei === '');

        let faltas: any[] = [];
        let sobras: any[] = [];
        let bateu: any[] = [];

        // VALIDAÇÃO 1: APARELHOS
        const sysImeis = new Map(sysAparelhos.map(d => [d.cleanSerial, d]));
        const physImeis = new Map(physAparelhos.map(p => [p.imei, p]));

        sysImeis.forEach((sysItem, imei) => {
          if (physImeis.has(imei)) {
            bateu.push({ tipo: 'Aparelho', descricao: sysItem.cleanDesc, imei: imei, qtd: 1 });
          } else {
            faltas.push({ tipo: 'Aparelho', descricao: sysItem.cleanDesc, imei: imei, qtd: 1, motivo: 'Não bipado na loja (Falta)' });
          }
        });

        physImeis.forEach((physItem, imei) => {
          if (!sysImeis.has(imei)) {
            sobras.push({ tipo: 'Aparelho', descricao: physItem.descricao, imei: imei, qtd: 1, motivo: 'Não consta no sistema ERP (Sobra)' });
          }
        });

        // VALIDAÇÃO 2: ACESSÓRIOS
        const sysAccMap = new Map();
        sysAcessorios.forEach(s => {
          const desc = s.cleanDesc;
          sysAccMap.set(desc, (sysAccMap.get(desc) || 0) + Number(s.quantity));
        });

        const physAccMap = new Map();
        physAcessorios.forEach(p => {
          const desc = p.descricao;
          physAccMap.set(desc, (physAccMap.get(desc) || 0) + Number(p.qtd));
        });

        const allAccDesc = new Set([...sysAccMap.keys(), ...physAccMap.keys()]);
        allAccDesc.forEach(desc => {
          const sysQtd = sysAccMap.get(desc) || 0;
          const physQtd = physAccMap.get(desc) || 0;
          const diff = physQtd - sysQtd;

          if (diff === 0 && sysQtd > 0) {
            bateu.push({ tipo: 'Acessório', descricao: desc, imei: '-', qtd: sysQtd });
          } else if (diff > 0) {
            if (sysQtd > 0) bateu.push({ tipo: 'Acessório', descricao: desc, imei: '-', qtd: sysQtd });
            sobras.push({ tipo: 'Acessório', descricao: desc, imei: '-', qtd: diff, motivo: 'Qtd Física Maior que o ERP' });
          } else if (diff < 0) {
            if (physQtd > 0) bateu.push({ tipo: 'Acessório', descricao: desc, imei: '-', qtd: physQtd });
            faltas.push({ tipo: 'Acessório', descricao: desc, imei: '-', qtd: Math.abs(diff), motivo: 'Qtd Física Menor que o ERP' });
          }
        });

        setAuditResults({ bateu, faltas, sobras });
        setActiveTab(faltas.length > 0 ? 'faltas' : (sobras.length > 0 ? 'sobras' : 'bateu'));

      } catch (err) {
        alert("Erro ao ler a planilha. Verifique se é um arquivo Excel válido.");
      }
    };
    reader.readAsArrayBuffer(file);
  };

  // --- FUNÇÃO DE EXPORTAÇÃO PARA EXCEL ---
  const exportToExcel = () => {
    if (!auditResults || !selectedStore) return;

    // Função auxiliar para mapear os dados formatados
    const formatData = (data: any[], statusTag: string) => data.map(item => ({
      'Status': statusTag,
      'Classificação': item.tipo,
      'Produto': item.descricao,
      'IMEI / Série': item.imei !== '-' ? item.imei : '',
      'Quantidade': item.qtd,
      'Diagnóstico / Motivo': item.motivo || 'OK'
    }));

    const dadosFaltas = formatData(auditResults.faltas, 'FALTA');
    const dadosSobras = formatData(auditResults.sobras, 'SOBRA');
    const dadosBateu = formatData(auditResults.bateu, 'CONFERIDO OK');

    // Junta tudo em uma aba só para facilitar filtros dinâmicos na diretoria
    const relatorioCompleto = [...dadosFaltas, ...dadosSobras, ...dadosBateu];

    const worksheet = XLSX.utils.json_to_sheet(relatorioCompleto);
    const workbook = XLSX.utils.book_new();
    
    // Ajusta a largura das colunas do Excel para ficar bonito
    worksheet['!cols'] = [
      { wch: 15 }, // Status
      { wch: 15 }, // Tipo
      { wch: 45 }, // Produto
      { wch: 20 }, // IMEI
      { wch: 12 }, // Quantidade
      { wch: 40 }, // Diagnostico
    ];

    XLSX.utils.book_append_sheet(workbook, worksheet, "Relatório de Auditoria");

    const dataHoje = new Date().toISOString().split('T')[0];
    const nomeArquivo = `Auditoria_${selectedStore.replace(/\s+/g, '_')}_${dataHoje}.xlsx`;

    XLSX.writeFile(workbook, nomeArquivo);
  };

  // --- RENDERIZAÇÃO DA SELEÇÃO DE LOJAS ---
  if (!selectedStore) {
    return (
      <div className="h-full overflow-y-auto p-6 bg-[#F0F2F5] font-sans text-slate-800">
        <div className="flex justify-between items-center mb-8">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <div className="p-2 bg-[#1428A0] rounded text-white"><Search size={20} /></div>
              <h1 className="text-2xl font-black uppercase tracking-tight text-[#1428A0]">Auditoria Lojas</h1>
            </div>
            <p className="text-xs font-bold text-slate-400 uppercase tracking-widest ml-12">Prevenção de Perdas & Validação</p>
          </div>
          <button onClick={loadStock} className="flex items-center gap-2 text-xs font-bold bg-white border border-slate-200 px-4 py-2 rounded-lg hover:bg-slate-50 transition-all text-slate-600 shadow-sm">
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} /> Sincronizar ERP
          </button>
        </div>

        {Object.entries(REGIOES).map(([regiao, lojas]) => (
          <div key={regiao} className="mb-8">
            <h2 className="text-sm font-black text-slate-400 uppercase tracking-widest mb-4 border-b border-slate-200 pb-2 flex items-center gap-2">
              <Store size={16} /> {regiao}
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
              {lojas.map(loja => {
                const qtdItems = stockRaw.filter(s => String(s.storeName).toUpperCase().includes(loja.toUpperCase())).length;
                return (
                  <button 
                    key={loja}
                    onClick={() => setSelectedStore(loja)}
                    className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm hover:shadow-md hover:border-blue-400 transition-all text-left group relative overflow-hidden"
                  >
                    <div className="absolute top-0 right-0 w-1 h-full bg-transparent group-hover:bg-blue-500 transition-colors"></div>
                    <div className="flex justify-between items-start mb-4">
                      <div className="p-2 bg-slate-50 text-slate-500 rounded-lg group-hover:bg-blue-50 group-hover:text-blue-600 transition-colors">
                        <Store size={20} />
                      </div>
                    </div>
                    <h3 className="font-bold text-slate-700 text-sm truncate uppercase mb-1">{loja}</h3>
                    <p className="text-xs text-slate-400 font-medium">{qtdItems} SKUs no sistema</p>
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    );
  }

  // --- CÁLCULOS DE KPI PARA O DASHBOARD ---
  const totalFaltas = auditResults?.faltas.reduce((acc: number, val: any) => acc + val.qtd, 0) || 0;
  const totalSobras = auditResults?.sobras.reduce((acc: number, val: any) => acc + val.qtd, 0) || 0;
  const totalBateu = auditResults?.bateu.reduce((acc: number, val: any) => acc + val.qtd, 0) || 0;
  const totalSistema = totalBateu + totalFaltas;
  const acuracia = totalSistema > 0 ? ((totalBateu / totalSistema) * 100).toFixed(1) : '0.0';

  // --- RENDERIZAÇÃO DA TELA DE AUDITORIA ---
  return (
    <div className="h-full overflow-y-auto p-4 md:p-6 bg-[#F0F2F5] font-sans text-slate-800">
      
      {/* Cabeçalho */}
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between mb-6 bg-white p-4 rounded-xl shadow-sm border border-slate-200 gap-4">
        <div className="flex items-center gap-4">
          <button onClick={() => { setSelectedStore(null); setAuditResults(null); setFile(null); }} className="p-2 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors text-slate-600">
            <ArrowLeft size={20} />
          </button>
          <div>
            <h2 className="text-lg font-black text-slate-800 uppercase flex items-center gap-2">
               {selectedStore}
            </h2>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Módulo de Auditoria Ativa</p>
          </div>
        </div>

        {/* Zona de Upload Compacta */}
        {!auditResults && (
          <div className="flex items-center gap-3 w-full md:w-auto bg-slate-50 p-2 rounded-lg border border-slate-200 border-dashed">
            <input 
              type="file" 
              accept=".xlsx, .xls" 
              onChange={handleFileUpload}
              className="text-xs text-slate-500 file:mr-2 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:text-[10px] file:font-bold file:bg-indigo-100 file:text-indigo-700 hover:file:bg-indigo-200 cursor-pointer w-48 md:w-auto"
            />
            <button 
              onClick={validarAuditoria}
              disabled={!file}
              className="bg-[#1428A0] hover:bg-blue-900 text-white px-4 py-1.5 rounded-md text-xs font-bold transition-all shadow-sm disabled:opacity-50 flex items-center gap-2"
            >
              <Target size={14} /> Validar
            </button>
          </div>
        )}
      </div>

      {/* RESULTADOS DA AUDITORIA */}
      {auditResults && (
        <div className="animate-fadeIn">
          
          {/* Dashboard KPIs */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-100 border-l-4 border-l-[#1428A0]">
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 flex items-center gap-1"><BarChart2 size={12}/> Acurácia Estoque</p>
              <h3 className="text-2xl font-black text-slate-800">{acuracia}%</h3>
            </div>
            <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-100 border-l-4 border-l-emerald-500">
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Itens Conferidos</p>
              <h3 className="text-2xl font-black text-emerald-600">{totalBateu}</h3>
            </div>
            <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-100 border-l-4 border-l-red-500">
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Faltas (Risco)</p>
              <h3 className="text-2xl font-black text-red-600">{totalFaltas}</h3>
            </div>
            <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-100 border-l-4 border-l-amber-500">
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Sobras (Excedente)</p>
              <h3 className="text-2xl font-black text-amber-600">{totalSobras}</h3>
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
            
            {/* Header das Abas e Botão Excel */}
            <div className="flex flex-col md:flex-row justify-between items-center border-b border-slate-200 bg-slate-50">
              <div className="flex w-full md:w-auto">
                <button onClick={() => setActiveTab('faltas')} className={`px-6 py-4 text-xs font-black uppercase tracking-widest flex items-center justify-center gap-2 transition-colors ${activeTab === 'faltas' ? 'bg-white text-red-600 border-t-2 border-t-red-600 shadow-sm' : 'text-slate-500 hover:bg-slate-100'}`}>
                  <XCircle size={16} /> Faltas
                </button>
                <button onClick={() => setActiveTab('sobras')} className={`px-6 py-4 text-xs font-black uppercase tracking-widest flex items-center justify-center gap-2 transition-colors ${activeTab === 'sobras' ? 'bg-white text-amber-600 border-t-2 border-t-amber-500 shadow-sm' : 'text-slate-500 hover:bg-slate-100'}`}>
                  <AlertTriangle size={16} /> Sobras
                </button>
                <button onClick={() => setActiveTab('bateu')} className={`px-6 py-4 text-xs font-black uppercase tracking-widest flex items-center justify-center gap-2 transition-colors ${activeTab === 'bateu' ? 'bg-white text-emerald-600 border-t-2 border-t-emerald-500 shadow-sm' : 'text-slate-500 hover:bg-slate-100'}`}>
                  <CheckCircle size={16} /> Estoque OK
                </button>
              </div>

              {/* BOTÃO MÁGICO DO EXCEL */}
              <div className="p-3 w-full md:w-auto flex justify-end">
                <button 
                  onClick={exportToExcel}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-lg text-xs font-bold transition-all shadow-md flex items-center gap-2 w-full md:w-auto justify-center"
                >
                  <Download size={14} /> Exportar Relatório (Excel)
                </button>
              </div>
            </div>

            {/* Tabela de Resultados Dinâmica */}
            <div className="overflow-x-auto max-h-[450px]">
              <table className="w-full text-left border-collapse">
                <thead className="sticky top-0 bg-white shadow-sm z-10 border-b border-slate-100">
                  <tr className="text-[10px] font-black text-slate-400 uppercase tracking-wider">
                    <th className="p-4">Classificação</th>
                    <th className="p-4">Produto</th>
                    <th className="p-4">Série / IMEI</th>
                    <th className="p-4 text-center">Qtd</th>
                    {activeTab !== 'bateu' && <th className="p-4">Diagnóstico</th>}
                  </tr>
                </thead>
                <tbody className="text-sm text-slate-600 divide-y divide-slate-50">
                  {auditResults[activeTab].length === 0 ? (
                    <tr>
                      <td colSpan={5} className="p-12 text-center flex flex-col items-center justify-center">
                        <CheckCircle size={40} className="text-slate-200 mb-3" />
                        <span className="text-slate-400 font-bold">Nenhum registro encontrado nesta categoria. Tudo certo!</span>
                      </td>
                    </tr>
                  ) : (
                    auditResults[activeTab].map((item: any, idx: number) => (
                      <tr key={idx} className="hover:bg-blue-50/50 transition-colors">
                        <td className="p-4">
                          <span className={`px-2 py-1 rounded text-[9px] font-black uppercase tracking-widest flex items-center w-max gap-1 ${item.tipo === 'Aparelho' ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-100 text-slate-600'}`}>
                            {item.tipo === 'Aparelho' ? <Smartphone size={12}/> : <Layers size={12}/>}
                            {item.tipo}
                          </span>
                        </td>
                        <td className="p-4 font-bold text-slate-700">{item.descricao}</td>
                        <td className="p-4 font-mono text-xs text-slate-500">{item.imei}</td>
                        <td className="p-4 text-center font-black text-slate-800">{item.qtd}</td>
                        {activeTab !== 'bateu' && (
                          <td className="p-4 text-xs font-bold">
                            <span className={`px-2 py-1 rounded-md ${activeTab === 'faltas' ? 'bg-red-50 text-red-600' : 'bg-amber-50 text-amber-600'}`}>
                              {item.motivo}
                            </span>
                          </td>
                        )}
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}