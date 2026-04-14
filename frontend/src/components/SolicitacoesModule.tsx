import React, { useEffect, useMemo, useState } from 'react';
import {
  Send,
  CheckCircle2,
  AlertCircle,
  Sparkles,
  Link2,
  ImagePlus,
  CalendarDays,
  DollarSign,
  FileText,
  Mail,
  BadgeInfo,
  Megaphone,
  LayoutTemplate,
  Paperclip
} from 'lucide-react';

// PRODUÇÃO
// const API_URL = "https://telefluxo-aplicacao.onrender.com/api/solicitacoes";

// TESTE LOCAL
const API_URL = "http://localhost:3000/api/solicitacoes";

type Props = {
  currentUser?: any;
};

type FormState = {
  lojaSolicitante: string;
  emailOrigem: string;
  tipoArte: string;
  tipoArteOutro: string;
  produtoFoco: string;
  precoVista: string;
  precoParcelado: string;
  quantidadeParcelas: string;
  validadeOferta: string;
  destaqueObrigatorio: string;
  referenciaLink: string;
};

const INITIAL_FORM: FormState = {
  lojaSolicitante: '',
  emailOrigem: '',
  tipoArte: 'Story',
  tipoArteOutro: '',
  produtoFoco: '',
  precoVista: '',
  precoParcelado: '',
  quantidadeParcelas: '',
  validadeOferta: '',
  destaqueObrigatorio: '',
  referenciaLink: '',
};

export default function SolicitacoesModule({ currentUser }: Props) {
  const lojaPadrao =
    currentUser?.loja ||
    currentUser?.store ||
    currentUser?.storeName ||
    currentUser?.operation ||
    '';

  const emailPadrao = currentUser?.email || '';

  const [form, setForm] = useState<FormState>(INITIAL_FORM);
  const [referenciaFile, setReferenciaFile] = useState<File | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    setForm((prev) => ({
      ...prev,
      lojaSolicitante: lojaPadrao || prev.lojaSolicitante,
      emailOrigem: emailPadrao || prev.emailOrigem,
    }));
  }, [lojaPadrao, emailPadrao]);

  const tipoArteOptions = useMemo(
    () => ['Story', 'Feed', 'Cartaz A4', 'Outro'],
    []
  );

  const formatCurrencyBRL = (value: string) => {
    const digits = value.replace(/\D/g, '');
    if (!digits) return '';
    const number = Number(digits) / 100;
    return number.toLocaleString('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    });
  };

  const normalizeInstallments = (value: string) => {
    const raw = value.trim();

    if (!raw) return '';

    const onlyDigits = raw.replace(/\D/g, '');
    if (!onlyDigits) return raw;

    if (/^\d+$/.test(raw.replace(/\s/g, ''))) {
      return `${onlyDigits}x`;
    }

    return raw;
  };

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleCurrencyChange =
    (field: 'precoVista' | 'precoParcelado') =>
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const formatted = formatCurrencyBRL(e.target.value);
      setForm((prev) => ({ ...prev, [field]: formatted }));
    };

  const handleInstallmentsChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const formatted = normalizeInstallments(e.target.value);
    setForm((prev) => ({ ...prev, quantidadeParcelas: formatted }));
  };

  const resetForm = () => {
    setForm({
      ...INITIAL_FORM,
      lojaSolicitante: lojaPadrao || '',
      emailOrigem: emailPadrao || '',
    });
    setReferenciaFile(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSuccessMsg('');
    setErrorMsg('');

    if (!form.lojaSolicitante.trim()) {
      setErrorMsg('Preencha a loja solicitante.');
      return;
    }

    if (!form.emailOrigem.trim()) {
      setErrorMsg('Preencha o e-mail de origem.');
      return;
    }

    if (!/\S+@\S+\.\S+/.test(form.emailOrigem.trim())) {
      setErrorMsg('Informe um e-mail de origem válido.');
      return;
    }

    if (!form.produtoFoco.trim()) {
      setErrorMsg('Preencha o produto foco.');
      return;
    }

    if (!form.validadeOferta.trim()) {
      setErrorMsg('Preencha a validade da oferta.');
      return;
    }

    if (form.tipoArte === 'Outro' && !form.tipoArteOutro.trim()) {
      setErrorMsg('Descreva o tipo de arte em "Outro".');
      return;
    }

    try {
      setIsSending(true);

      const payload = new FormData();
      payload.append('lojaSolicitante', form.lojaSolicitante);
      payload.append('emailOrigem', form.emailOrigem);
      payload.append('tipoArte', form.tipoArte);
      payload.append('tipoArteOutro', form.tipoArteOutro);
      payload.append('produtoFoco', form.produtoFoco);
      payload.append('precoVista', form.precoVista);
      payload.append('precoParcelado', form.precoParcelado);
      payload.append('quantidadeParcelas', form.quantidadeParcelas);
      payload.append('validadeOferta', form.validadeOferta);
      payload.append('destaqueObrigatorio', form.destaqueObrigatorio);
      payload.append('referenciaLink', form.referenciaLink);

      payload.append('solicitanteNome', currentUser?.name || '');
      payload.append('solicitanteCargo', currentUser?.role || '');
      payload.append('solicitanteSetor', currentUser?.operation || '');
      payload.append('solicitanteEmailSistema', currentUser?.email || '');

      if (referenciaFile) {
        payload.append('referenciaFile', referenciaFile);
      }

      const response = await fetch(API_URL, {
        method: 'POST',
        body: payload,
      });

      const contentType = response.headers.get('content-type') || '';

      if (!contentType.includes('application/json')) {
        const raw = await response.text();
        throw new Error(raw || 'Resposta inesperada do servidor.');
      }

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.error || 'Não foi possível enviar a solicitação.');
      }

      setSuccessMsg('Solicitação enviada com sucesso para o time de marketing.');
      resetForm();
    } catch (err: any) {
      setErrorMsg(err.message || 'Erro ao enviar solicitação.');
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto bg-[#f8fafc] p-6 md:p-8">
      <div className="max-w-7xl mx-auto space-y-6">
        <section className="bg-white border border-slate-200 rounded-[2rem] shadow-sm overflow-hidden">
          <div className="px-8 py-7 border-b border-slate-100">
            <div className="flex flex-col xl:flex-row xl:items-center xl:justify-between gap-6">
              <div>
                <div className="inline-flex items-center gap-2 bg-fuchsia-50 text-fuchsia-600 border border-fuchsia-100 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest mb-4">
                  <Sparkles size={12} />
                  Módulo de Solicitações
                </div>

                <h1 className="text-3xl font-black text-slate-800 tracking-tight">
                  Solicitações de Arte
                </h1>

                <p className="text-slate-500 mt-2 max-w-3xl text-sm md:text-base leading-relaxed">
                  Preencha o formulário abaixo para enviar solicitações. O pedido será encaminhado automaticamente para{' '}
                  <span className="font-bold">marketinggrupotelecel@gmail.com</span>
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 w-full xl:w-auto">
                <HeaderMiniCard
                  icon={<Megaphone size={14} />}
                  title="Destino"
                  value="Marketing"
                />
                <HeaderMiniCard
                  icon={<LayoutTemplate size={14} />}
                  title="Formato"
                  value="Google Form"
                />
                <HeaderMiniCard
                  icon={<Paperclip size={14} />}
                  title="Anexos"
                  value="Opcionais"
                />
              </div>
            </div>
          </div>

          <div className="px-8 py-4 bg-slate-50 border-t border-white">
            <div className="flex flex-wrap items-center gap-3 text-[11px] font-bold uppercase tracking-wider text-slate-500">
              <span className="inline-flex items-center gap-2 bg-white border border-slate-200 px-3 py-2 rounded-xl">
                <Mail size={13} className="text-fuchsia-600" />
                Resposta pelo e-mail de origem
              </span>
              <span className="inline-flex items-center gap-2 bg-white border border-slate-200 px-3 py-2 rounded-xl">
                <ImagePlus size={13} className="text-fuchsia-600" />
                Link e imagem não obrigatórios
              </span>
            </div>
          </div>
        </section>

        <section className="grid grid-cols-1 xl:grid-cols-[1.55fr_0.75fr] gap-6">
          <div className="bg-white border border-slate-200 rounded-[2rem] shadow-sm overflow-hidden">
            <div className="px-8 py-6 border-b border-slate-100">
              <h2 className="text-xl font-black text-slate-800">Preencher solicitação</h2>
            </div>

            <form onSubmit={handleSubmit} className="p-8 space-y-6">
              {successMsg && (
                <div className="bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-2xl p-4 flex items-center gap-3 font-bold">
                  <CheckCircle2 size={18} />
                  {successMsg}
                </div>
              )}

              {errorMsg && (
                <div className="bg-red-50 border border-red-200 text-red-700 rounded-2xl p-4 flex items-center gap-3 font-bold">
                  <AlertCircle size={18} />
                  {errorMsg}
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <Field label="Loja solicitante" required>
                  <input
                    name="lojaSolicitante"
                    value={form.lojaSolicitante}
                    onChange={handleChange}
                    className={inputClassName}
                    placeholder="Nome da loja"
                  />
                </Field>

                <Field label="E-mail de origem" required icon={<Mail size={15} />}>
                  <input
                    type="email"
                    name="emailOrigem"
                    value={form.emailOrigem}
                    onChange={handleChange}
                    className={inputClassName}
                    placeholder="email@exemplo.com"
                  />
                </Field>
              </div>

              <div className={`grid gap-5 ${form.tipoArte === 'Outro' ? 'grid-cols-1 md:grid-cols-2' : 'grid-cols-1 md:grid-cols-2'}`}>
                <Field label="Tipo de arte" required>
                  <select
                    name="tipoArte"
                    value={form.tipoArte}
                    onChange={handleChange}
                    className={inputClassName}
                  >
                    {tipoArteOptions.map((item) => (
                      <option key={item}>{item}</option>
                    ))}
                  </select>
                </Field>

                {form.tipoArte === 'Outro' ? (
                  <Field label="Descreva o tipo de arte" required>
                    <input
                      name="tipoArteOutro"
                      value={form.tipoArteOutro}
                      onChange={handleChange}
                      className={inputClassName}
                      placeholder="Ex.: banner vitrine, adesivo, faixa, etc."
                    />
                  </Field>
                ) : (
                  <EmptyField />
                )}
              </div>

              <Field label="Produto foco" required>
                <textarea
                  name="produtoFoco"
                  value={form.produtoFoco}
                  onChange={handleChange}
                  rows={4}
                  className={textareaClassName}
                  placeholder="Detalhe o nome do produto, armazenamento e qualquer informação relevante."
                />
              </Field>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                <Field label="Preço à vista" icon={<DollarSign size={15} />}>
                  <input
                    name="precoVista"
                    value={form.precoVista}
                    onChange={handleCurrencyChange('precoVista')}
                    inputMode="numeric"
                    className={inputClassName}
                    placeholder="R$ 0,00"
                  />
                </Field>

                <Field label="Preço parcelado" icon={<DollarSign size={15} />}>
                  <input
                    name="precoParcelado"
                    value={form.precoParcelado}
                    onChange={handleCurrencyChange('precoParcelado')}
                    inputMode="numeric"
                    className={inputClassName}
                    placeholder="R$ 0,00"
                  />
                </Field>

                <Field label="Em quantas vezes">
                  <input
                    name="quantidadeParcelas"
                    value={form.quantidadeParcelas}
                    onChange={handleInstallmentsChange}
                    className={inputClassName}
                    placeholder="Ex.: 10x sem juros"
                  />
                </Field>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <Field label="Validade da oferta" required icon={<CalendarDays size={15} />}>
                  <input
                    type="date"
                    name="validadeOferta"
                    value={form.validadeOferta}
                    onChange={handleChange}
                    className={inputClassName}
                  />
                </Field>

                <Field label="Precisa incluir algum destaque obrigatório?" icon={<BadgeInfo size={15} />}>
                  <input
                    name="destaqueObrigatorio"
                    value={form.destaqueObrigatorio}
                    onChange={handleChange}
                    className={inputClassName}
                    placeholder="Ex.: parcelamento, troca smart, cashback..."
                  />
                </Field>
              </div>

              <div className="bg-blue-50 border border-blue-100 rounded-2xl px-4 py-4 flex items-start gap-3">
                <div className="w-9 h-9 rounded-xl bg-white border border-blue-100 text-blue-600 flex items-center justify-center shrink-0">
                  <BadgeInfo size={16} />
                </div>
                <div>
                  <p className="text-sm font-black text-blue-700">Campos opcionais</p>
                  <p className="text-sm text-blue-700/90 mt-1">
                    Os campos <span className="font-black">Link de referência</span> e <span className="font-black">Anexar imagem</span> não são obrigatórios.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <Field label="Link de referência" icon={<Link2 size={15} />} optional>
                  <input
                    name="referenciaLink"
                    value={form.referenciaLink}
                    onChange={handleChange}
                    className={inputClassName}
                    placeholder="Cole um link do Drive, imagem, campanha, etc."
                  />
                </Field>

                <Field label="Anexar imagem" icon={<ImagePlus size={15} />} optional>
                  <label className={uploadClassName}>
                    <span className="text-slate-600 font-semibold truncate pr-3">
                      {referenciaFile ? referenciaFile.name : 'Selecionar arquivo'}
                    </span>
                    <span className="text-[10px] font-black uppercase tracking-widest text-fuchsia-600 shrink-0">
                      Upload
                    </span>
                    <input
                      type="file"
                      accept="image/*,.pdf"
                      className="hidden"
                      onChange={(e) => setReferenciaFile(e.target.files?.[0] || null)}
                    />
                  </label>
                </Field>
              </div>

              <div className="pt-2 flex justify-end">
                <button
                  type="submit"
                  disabled={isSending}
                  className={`min-w-[230px] px-8 py-3 rounded-2xl text-white font-black text-xs uppercase tracking-widest flex items-center justify-center gap-2 shadow-lg transition-all active:scale-95 ${
                    isSending
                      ? 'bg-slate-400 cursor-not-allowed'
                      : 'bg-fuchsia-600 hover:bg-fuchsia-700'
                  }`}
                >
                  <Send size={16} />
                  {isSending ? 'Enviando...' : 'Enviar Solicitação'}
                </button>
              </div>
            </form>
          </div>

          <div className="space-y-4">
            <ExecutiveSideCard
              icon={<FileText size={18} />}
              title="O que enviar"
              text="Nome correto do produto, armazenamento, preço à vista, parcelado e validade."
            />
            <ExecutiveSideCard
              icon={<LayoutTemplate size={18} />}
              title="Formatos aceitos"
              text="Story, feed, cartaz A4 e qualquer outro formato que você descrever."
            />
            <ExecutiveSideCard
              icon={<ImagePlus size={18} />}
              title="Referência opcional"
              text="Você pode anexar uma imagem ou colar um link para ajudar no briefing."
            />
          </div>
        </section>
      </div>
    </div>
  );
}

const inputClassName =
  'w-full h-[56px] bg-slate-50 border border-slate-200 rounded-2xl px-4 font-semibold text-slate-700 outline-none focus:border-fuchsia-500 transition-colors';

const textareaClassName =
  'w-full resize-none bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3 font-semibold text-slate-700 outline-none focus:border-fuchsia-500 transition-colors';

const uploadClassName =
  'w-full h-[56px] flex items-center justify-between gap-3 bg-slate-50 border border-slate-200 rounded-2xl px-4 cursor-pointer hover:border-fuchsia-300 transition-colors';

function Field({
  label,
  children,
  required = false,
  optional = false,
  icon,
}: {
  label: string;
  children: React.ReactNode;
  required?: boolean;
  optional?: boolean;
  icon?: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <label className="min-h-[34px] text-[11px] font-black uppercase tracking-widest text-slate-500 flex items-center gap-2 leading-tight">
        {icon}
        <span>{label}</span>
        {required && <span className="text-red-500">*</span>}
        {optional && (
          <span className="text-slate-400 normal-case tracking-normal text-[11px] font-semibold">
            (opcional)
          </span>
        )}
      </label>
      {children}
    </div>
  );
}

function EmptyField() {
  return <div className="hidden md:block" />;
}

function HeaderMiniCard({
  icon,
  title,
  value,
}: {
  icon: React.ReactNode;
  title: string;
  value: string;
}) {
  return (
    <div className="bg-slate-50 border border-slate-200 rounded-2xl px-4 py-4 min-w-[150px]">
      <div className="flex items-center gap-2 text-slate-400 text-[10px] font-black uppercase tracking-widest">
        <span className="text-fuchsia-600">{icon}</span>
        {title}
      </div>
      <p className="text-lg font-black text-slate-800 mt-2">{value}</p>
    </div>
  );
}

function ExecutiveSideCard({
  icon,
  title,
  text,
}: {
  icon: React.ReactNode;
  title: string;
  text: string;
}) {
  return (
    <div className="bg-white border border-slate-200 rounded-[1.5rem] p-5 shadow-sm">
      <div className="flex items-start gap-4">
        <div className="w-11 h-11 rounded-2xl bg-fuchsia-50 text-fuchsia-600 flex items-center justify-center shrink-0">
          {icon}
        </div>
        <div>
          <h3 className="text-base font-black text-slate-800">{title}</h3>
          <p className="text-sm text-slate-500 mt-2 leading-relaxed">{text}</p>
        </div>
      </div>
    </div>
  );
}