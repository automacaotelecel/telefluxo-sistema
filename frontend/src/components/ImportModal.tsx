import React, { useState, useRef } from 'react';
import { X, Upload, FileSpreadsheet, CheckCircle2 } from 'lucide-react';

export default function ImportModal({ isOpen, onClose, onImportSuccess }: any) {
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

  if (!isOpen) return null;

  const handleImport = async () => {
    if (!file) return alert("Selecione um arquivo CSV!");
    
    setLoading(true);
    const data = new FormData();
    data.append('file', file);

    try {
        const res = await fetch(`${API_URL}/import-payments`, { method: 'POST', body: data });
        const json = await res.json();
        
        if (res.ok) {
            alert(`Sucesso! ${json.total} demandas foram criadas.`);
            onImportSuccess(); // Atualiza a lista lá no fundo
            onClose(); // Fecha o modal
        } else {
            alert("Erro na importação: " + (json.error || "Desconhecido"));
        }
    } catch (error) {
        alert("Erro de conexão com o servidor.");
    } finally {
        setLoading(false);
        setFile(null);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[120] flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-md rounded-[32px] shadow-2xl p-8 animate-in zoom-in duration-200">
        
        <div className="flex justify-between items-center mb-6">
            <h2 className="text-xl font-black uppercase italic tracking-tighter text-slate-800 flex items-center gap-2">
                <FileSpreadsheet className="text-green-600"/> Importar Pagamentos
            </h2>
            <button onClick={onClose}><X className="text-slate-400 hover:text-red-500"/></button>
        </div>

        <p className="text-xs text-slate-500 mb-4 font-bold">
            Selecione o arquivo .CSV com as colunas:<br/>
            <span className="text-slate-800 bg-slate-100 px-1 rounded">Titulo, Vencimento, Valor, Responsavel, Origem</span>
        </p>

        <div 
            onClick={() => fileInputRef.current?.click()}
            className={`w-full h-32 border-2 border-dashed rounded-2xl cursor-pointer flex flex-col items-center justify-center gap-3 transition-all ${file ? 'border-green-500 bg-green-50' : 'border-slate-300 bg-slate-50 hover:bg-slate-100'}`}
        >
            <input type="file" ref={fileInputRef} accept=".csv" className="hidden" onChange={(e: any) => setFile(e.target.files[0])} />
            {file ? (
                <>
                    <CheckCircle2 size={32} className="text-green-600"/>
                    <span className="text-sm font-black text-green-700 text-center px-4">{file.name}</span>
                </>
            ) : (
                <>
                    <Upload size={32} className="text-slate-400"/>
                    <span className="text-xs font-bold text-slate-400 uppercase">Clique para selecionar CSV</span>
                </>
            )}
        </div>

        <button 
            onClick={handleImport} 
            disabled={loading || !file}
            className="w-full mt-6 py-4 bg-green-600 text-white rounded-2xl font-black uppercase tracking-widest hover:bg-green-700 transition-all disabled:opacity-50 flex justify-center"
        >
            {loading ? "Processando..." : "Gerar Demandas"}
        </button>

      </div>
    </div>
  );
}