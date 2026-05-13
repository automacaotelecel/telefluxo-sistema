import { useEffect, useMemo, useState } from 'react';
import {
  Search,
  Store,
  Upload,
  FileCheck2,
  AlertTriangle,
  CheckCircle2,
  FolderOpen,
  ArrowRightLeft,
  FileText,
  ClipboardCheck,
  Utensils,
  Bus,
  Trash2,
  BellRing,
  FilterX,
  UserRound,
  Users,
} from 'lucide-react';

type RhDocType = 'vale_transporte' | 'vale_alimentacao' | 'folha_ponto' | 'documentos_gerais';

type RhDocStatus = {
  status: 'pendente' | 'enviando' | 'enviado' | 'erro';
  fileName?: string;
  uploadedAt?: string;
  url?: string;
};

type RhCollaborator = {
  id: string;
  loja: string;
  nome: string;
  docs: Record<RhDocType, RhDocStatus>;
};

type RhModuleProps = {
  currentUser?: any;
};

type StatusFilter = 'todos' | 'pendentes' | 'validados';

const DOCUMENT_TYPES: Array<{
  key: RhDocType;
  label: string;
  shortLabel: string;
  icon: any;
}> = [
  { key: 'vale_transporte', label: 'Vale transporte', shortLabel: 'VT', icon: Bus },
  { key: 'vale_alimentacao', label: 'Vale alimentação', shortLabel: 'VA', icon: Utensils },
  { key: 'folha_ponto', label: 'Folha de ponto', shortLabel: 'Ponto', icon: ClipboardCheck },
  { key: 'documentos_gerais', label: 'Documentos gerais', shortLabel: 'Gerais', icon: FileText },
];

const INITIAL_COLLABORATORS_SOURCE = [
  {
    "loja": "UBERLÂNDIA",
    "nome": "MARIANA MARQUES FERREIRA"
  },
  {
    "loja": "UBERLÂNDIA",
    "nome": "FERNANDA ALVES GARCIA"
  },
  {
    "loja": "UBERLÂNDIA",
    "nome": "PEDRO HENRIQUE QUEIROZ ARAUJO"
  },
  {
    "loja": "UBERLÂNDIA",
    "nome": "HELENA MARIA LIMA FREITAS"
  },
  {
    "loja": "UBERLÂNDIA",
    "nome": "PATRICIA RENATA AOKI"
  },
  {
    "loja": "JK SHOPPING",
    "nome": "LUCAS FERNANDO SANTOS DA SILVA"
  },
  {
    "loja": "JK SHOPPING",
    "nome": "JHONATAS AMARAL CARVALHO"
  },
  {
    "loja": "JK SHOPPING",
    "nome": "MATHEUS LIRA LEAL"
  },
  {
    "loja": "JK SHOPPING",
    "nome": "DIEGO DE ASSIS BLANDIM"
  },
  {
    "loja": "JK SHOPPING",
    "nome": "EVERTON CARVALHO DE SOUZA"
  },
  {
    "loja": "UBERABA",
    "nome": "THAMYRES GONCALVES RODRIGUES DE ANDRADE"
  },
  {
    "loja": "UBERABA",
    "nome": "SCARLLET ROSENDO CAVALCANTE"
  },
  {
    "loja": "UBERABA",
    "nome": "JEANDERSON MORAIS DOS SANTOS"
  },
  {
    "loja": "UBERABA",
    "nome": "DANIEL SANTOS FERREIRA"
  },
  {
    "loja": "UBERABA",
    "nome": "EVELLYN VICTORIA DOS SANTOS"
  },
  {
    "loja": "GOIANIA SHOPPING",
    "nome": "BIANCA CAMARA LIMA"
  },
  {
    "loja": "GOIANIA SHOPPING",
    "nome": "VITORIA DOS SANTOS MELO"
  },
  {
    "loja": "GOIANIA SHOPPING",
    "nome": "MATHEUS FERNANDO RODRIGUES DE SOUZA"
  },
  {
    "loja": "GOIANIA SHOPPING",
    "nome": "THAIS DE JESUS MENEZES"
  },
  {
    "loja": "GOIANIA SHOPPING",
    "nome": "VANESSA CRISTINA LISBOA"
  },
  {
    "loja": "GOIANIA SHOPPING",
    "nome": "ARTUR CAMARGO REMIGIO"
  },
  {
    "loja": "BRASILIA SHOPPING",
    "nome": "EVANDRO DE SOUZA"
  },
  {
    "loja": "BRASILIA SHOPPING",
    "nome": "ALAN BATISTA DOS SANTOS"
  },
  {
    "loja": "BRASILIA SHOPPING",
    "nome": "LUA RODRIGUES DE SOUSA"
  },
  {
    "loja": "BRASILIA SHOPPING",
    "nome": "JANINE SILVA DORNELAS"
  },
  {
    "loja": "BRASILIA SHOPPING",
    "nome": "CESAR AUGUSTO VIEIRA DE SOUSA"
  },
  {
    "loja": "PARK SHOPPING",
    "nome": "CARLOS ALBERTO SOUZA SILVA JUNIOR"
  },
  {
    "loja": "PARK SHOPPING",
    "nome": "JHONATA LIMA DA SILVA"
  },
  {
    "loja": "PARK SHOPPING",
    "nome": "DANIELE DA SILVA GONZAGA"
  },
  {
    "loja": "PARK SHOPPING",
    "nome": "JOAO PAULO VALE TORRES"
  },
  {
    "loja": "PARK SHOPPING",
    "nome": "CRISTIANO SOARES SILVA"
  },
  {
    "loja": "PARK SHOPPING",
    "nome": "ADRIANE MUNIZ SILVA"
  },
  {
    "loja": "PATIO BRASIL",
    "nome": "HYAN ALVES CARVALHO"
  },
  {
    "loja": "PATIO BRASIL",
    "nome": "MARCUS VINICIUS DA COSTA LOPES"
  },
  {
    "loja": "IGUATEMI SHOPPING",
    "nome": "RANIELE FERNANDES DE SOUZA"
  },
  {
    "loja": "IGUATEMI SHOPPING",
    "nome": "WALISSON ARAUJO PIRES"
  },
  {
    "loja": "IGUATEMI SHOPPING",
    "nome": "GUILHERME AZEVEDO COSTA"
  },
  {
    "loja": "IGUATEMI SHOPPING",
    "nome": "THALISSON DE SOUSA PAULO"
  },
  {
    "loja": "CNB QUIOSQUE",
    "nome": "LUCAS GUILHERME DE BRITO FERREIRA"
  },
  {
    "loja": "CNB QUIOSQUE",
    "nome": "ANA PAULA QUEIROZ"
  },
  {
    "loja": "CNB QUIOSQUE",
    "nome": "VINICIUS LUIZ OLIVEIRA BRITO"
  },
  {
    "loja": "CNB QUIOSQUE",
    "nome": "MATHEUS INACIO DINIZ DA SILVA"
  },
  {
    "loja": "CNB QUIOSQUE",
    "nome": "MATHEUS CAVALCANTE SANTOS OLIVEIRA"
  },
  {
    "loja": "TAGUATINGA SHOPPING",
    "nome": "ALESSANDRO TOLENTINO VIEIRA"
  },
  {
    "loja": "TAGUATINGA SHOPPING",
    "nome": "NAIR MENDES DA SILVA"
  },
  {
    "loja": "TAGUATINGA SHOPPING",
    "nome": "RODRIGO GOMES ARANHA"
  },
  {
    "loja": "TAGUATINGA SHOPPING",
    "nome": "JUAN GONÇALVES DIAS"
  },
  {
    "loja": "TAGUATINGA SHOPPING",
    "nome": "MARCUS VINICIUS NOVAES SOUZA"
  },
  {
    "loja": "TAGUATINGA SHOPPING",
    "nome": "THIAGO CABRAL MARTINS"
  },
  {
    "loja": "ARAGUAIA SHOPPING",
    "nome": "LUIZ FERNANDO MOREIRA DA SILVA"
  },
  {
    "loja": "ARAGUAIA SHOPPING",
    "nome": "DENILSON DA MOTA DE SOUSA"
  },
  {
    "loja": "ARAGUAIA SHOPPING",
    "nome": "MAYLLA SANTOS GOMES"
  },
  {
    "loja": "ARAGUAIA SHOPPING",
    "nome": "VICTOR DO NASCIMENTO GERMANO"
  },
  {
    "loja": "ARAGUAIA SHOPPING",
    "nome": "HENRIQUE MARDOCHEU PERIM GUIMARAES"
  },
  {
    "loja": "ARAGUAIA SHOPPING",
    "nome": "ARMANDO BERNARDES DUARTE"
  },
  {
    "loja": "ARAGUAIA SHOPPING",
    "nome": "Gustavo Pereira da Silva"
  },
  {
    "loja": "TERRAÇO SHOPPING",
    "nome": "Maria Eduarda Bomfim de Sales"
  },
  {
    "loja": "TERRAÇO SHOPPING",
    "nome": "AURELIEN LOPES DE FARIAS"
  },
  {
    "loja": "TERRAÇO SHOPPING",
    "nome": "WELLINGTON GOMES DA SILVA"
  },
  {
    "loja": "TERRAÇO SHOPPING",
    "nome": "HENRIQUE JUNIO FIGUEIREDO CATALDI"
  },
  {
    "loja": "TERRAÇO SHOPPING",
    "nome": "ANDERSON DA COSTA SILVA"
  },
  {
    "loja": "TERRAÇO SHOPPING",
    "nome": "MARCELO FELIX DOS SANTOS"
  },
  {
    "loja": "CNB SHOPPING",
    "nome": "JORGE HENRIQUE MARTINS SANTOS CHAVES"
  },
  {
    "loja": "CNB SHOPPING",
    "nome": "SILVIO PITA HIPPERTT"
  },
  {
    "loja": "CNB SHOPPING",
    "nome": "DANIEL ALVES DE SOUZA"
  },
  {
    "loja": "CNB SHOPPING",
    "nome": "DIONATA SILVA QUEIROZ FERNANDES"
  },
  {
    "loja": "CNB SHOPPING",
    "nome": "HELIO GEOVANE PEREIRA DE ARAUJO"
  },
  {
    "loja": "CNB SHOPPING",
    "nome": "GUSTAVO SANTANA DOS SANTOS"
  },
  {
    "loja": "BOULEVARD SHOPPING",
    "nome": "ANTONIO LUCAS SILVA CARVALHO"
  },
  {
    "loja": "BOULEVARD SHOPPING",
    "nome": "ANDERSON ALVES CAMPOS"
  },
  {
    "loja": "BOULEVARD SHOPPING",
    "nome": "EDUARDO OLIVEIRA LEMOS"
  },
  {
    "loja": "BOULEVARD SHOPPING",
    "nome": "RYAN MESQUITA SILVA"
  },
  {
    "loja": "PASSEIO DAS AGUAS",
    "nome": "ERICK SULLIVAN CATÚLIO DOS SANTOS"
  },
  {
    "loja": "PASSEIO DAS AGUAS",
    "nome": "JOSE HENRIQUE FERNANDES NERIS"
  },
  {
    "loja": "PASSEIO DAS AGUAS",
    "nome": "VITOR GABRIEL BASILIO VIEIRA"
  },
  {
    "loja": "PASSEIO DAS AGUAS",
    "nome": "HALAN ARAUJO FEITOSA"
  },
  {
    "loja": "SHOPPING SUL",
    "nome": "ELCIAS EBER GOMES DA SILVA"
  },
  {
    "loja": "SHOPPING SUL",
    "nome": "MARIA APARECIDA DA CRUZ"
  },
  {
    "loja": "SHOPPING SUL",
    "nome": "LUCAS DA SILVA FERREIRA"
  },
  {
    "loja": "SHOPPING SUL",
    "nome": "FABIO MARTINS CRUZ DOS SANTOS"
  },
  {
    "loja": "FLAMBOYANT SHOPPING",
    "nome": "ANA CLARA GONÇALVES DE ALMEIDA"
  },
  {
    "loja": "FLAMBOYANT SHOPPING",
    "nome": "ARTHUR SANTOS ABREU"
  },
  {
    "loja": "FLAMBOYANT SHOPPING",
    "nome": "EDUARDO ALVES MARINHO"
  },
  {
    "loja": "FLAMBOYANT SHOPPING",
    "nome": "ITALO GUSTAVO BASILIO VIEIRA"
  },
  {
    "loja": "FLAMBOYANT SHOPPING",
    "nome": "LUCAS FELISBERTO PEREIRA"
  },
  {
    "loja": "BURITI RIO VERDE",
    "nome": "HEITOR ROBERTO VILELA GIELOW"
  },
  {
    "loja": "BURITI RIO VERDE",
    "nome": "ANA VITORIA DINIZ DOS ANJOS"
  },
  {
    "loja": "BURITI RIO VERDE",
    "nome": "REVILTON DA SILVA"
  },
  {
    "loja": "BURITI RIO VERDE",
    "nome": "DJHON MAICON DA PAIXAO SANTOS"
  },
  {
    "loja": "BURITI SHOPPING",
    "nome": "Lucas Eduardo Dos Santos Lauriano"
  },
  {
    "loja": "BURITI SHOPPING",
    "nome": "DAVI BARROS DA SILVA"
  },
  {
    "loja": "BURITI SHOPPING",
    "nome": "HELDER LOPES BARBOSA SANTANA"
  },
  {
    "loja": "BURITI SHOPPING",
    "nome": "JOAO VICTOR DA SILVA GOMES"
  },
  {
    "loja": "PORTAL SHOPPING",
    "nome": "WILLIAN GABRIEL VIEIRA DA SILVA"
  },
  {
    "loja": "PORTAL SHOPPING",
    "nome": "EDUARDO CARVALHO VIANA"
  },
  {
    "loja": "PORTAL SHOPPING",
    "nome": "JOSE VITOR GOMES DE MORAIS"
  },
  {
    "loja": "PORTAL SHOPPING",
    "nome": "YURE MOREIRA DA SILVA SANTOS"
  },
  {
    "loja": "PARK ANAPOLIS",
    "nome": "VITOR HUGO DE JESUS ROCHA"
  },
  {
    "loja": "PARK ANAPOLIS",
    "nome": "LUANA DA SILVA PEREIRA"
  },
  {
    "loja": "PARK ANAPOLIS",
    "nome": "BRUNO MARQUES A. BARBOSA NASCIMENTO"
  },
  {
    "loja": "PARK ANAPOLIS",
    "nome": "FERNANDA DE SOUZA CAMELO CALDAS"
  },
  {
    "loja": "PARK ANAPOLIS",
    "nome": "JENNIFFER DE ASSIS FAUSTINO"
  },
  {
    "loja": "SHOPPING RECIFE",
    "nome": "POLLYANNA MARIA DE ALMEIDA PERNAMBUCO"
  },
  {
    "loja": "SHOPPING RECIFE",
    "nome": "ELTON JOSE DA SILVA PINO"
  },
  {
    "loja": "SHOPPING RECIFE",
    "nome": "WIBSON DA SILVA CAVALCANTE"
  },
  {
    "loja": "SHOPPING RECIFE",
    "nome": "MIRELA MARIA EZAQUIEL DA SILVA"
  },
  {
    "loja": "SHOPPING RECIFE",
    "nome": "JOSIVAN RODRIGUES DE FRANÇA"
  },
  {
    "loja": "MANAIRA SHOPPING",
    "nome": "ZELIO MARCOLINO RICARDO"
  },
  {
    "loja": "MANAIRA SHOPPING",
    "nome": "Luis Felipe da Silva Freitas"
  },
  {
    "loja": "MANAIRA SHOPPING",
    "nome": "Thales Eduardo de Souza Mostre"
  },
  {
    "loja": "MANAIRA SHOPPING",
    "nome": "VIVIANE LAYS DA SILVA CASTRO"
  },
  {
    "loja": "MANAIRA SHOPPING",
    "nome": "CARLA ISABEL DE OLIVEIRA VIEIRA"
  },
  {
    "loja": "IGUATEMI FORTALEZA",
    "nome": "LIGIANE RODRIGUES DE SOUSA TEMOTEO"
  },
  {
    "loja": "IGUATEMI FORTALEZA",
    "nome": "FRANCISCO ALISSON RODRIGUES LIMA"
  },
  {
    "loja": "IGUATEMI FORTALEZA",
    "nome": "JIM MORRISON OLIVEIRA ALLEN MAIA"
  },
  {
    "loja": "IGUATEMI FORTALEZA",
    "nome": "JOÃO BATISTA DA SILVA FILHO"
  },
  {
    "loja": "IGUATEMI FORTALEZA",
    "nome": "FRANCISCO LUCIO DE FREITAS SANTOS"
  }
];

function normalizeText(value: string): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\bSSG\b/g, '')
    .replace(/\bSAMSUNG\b/g, '')
    .replace(/\bLOJA\b/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

function makeCollaboratorId(loja: string, nome: string): string {
  return `${normalizeText(loja)}-${normalizeText(nome)}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

function makeEmptyDocs(): Record<RhDocType, RhDocStatus> {
  return {
    vale_transporte: { status: 'pendente' },
    vale_alimentacao: { status: 'pendente' },
    folha_ponto: { status: 'pendente' },
    documentos_gerais: { status: 'pendente' },
  };
}

function buildInitialCollaborators(): RhCollaborator[] {
  return INITIAL_COLLABORATORS_SOURCE.map((item) => ({
    id: makeCollaboratorId(item.loja, item.nome),
    loja: item.loja,
    nome: item.nome,
    docs: makeEmptyDocs(),
  }));
}

function isAdminUser(user: any): boolean {
  const role = String(user?.role || '').trim().toUpperCase();

  return (
    role === 'ADM' ||
    role === 'ADMIN' ||
    role === 'CEO' ||
    role === 'DIRETOR' ||
    user?.isAdmin === true ||
    Number(user?.isAdmin) === 1
  );
}

function isStoreUser(user: any): boolean {
  return String(user?.role || '').trim().toUpperCase() === 'LOJA';
}

function getUserStoreName(user: any): string {
  return normalizeText(
    user?.loja ||
      user?.store ||
      user?.storeName ||
      user?.operation ||
      user?.name ||
      ''
  );
}

function isCollaboratorValidated(collaborator: RhCollaborator): boolean {
  return DOCUMENT_TYPES.every((doc) => collaborator.docs[doc.key]?.status === 'enviado');
}

function getPendingDocTypes(collaborator: RhCollaborator) {
  return DOCUMENT_TYPES.filter((doc) => collaborator.docs[doc.key]?.status !== 'enviado');
}

function countPendingDocs(collaborators: RhCollaborator[]): number {
  return collaborators.reduce((total, collaborator) => total + getPendingDocTypes(collaborator).length, 0);
}

function formatDate(value?: string): string {
  if (!value) return '';

  try {
    return new Intl.DateTimeFormat('pt-BR', {
      dateStyle: 'short',
      timeStyle: 'short',
    }).format(new Date(value));
  } catch {
    return value;
  }
}


function getAuthHeaders(currentUser: any): Record<string, string> {
  return currentUser?.id ? { 'X-User-Id': String(currentUser.id) } : {};
}

function getJsonAuthHeaders(currentUser: any): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    ...getAuthHeaders(currentUser),
  };
}

function normalizeCollaboratorsFromApi(payload: any): RhCollaborator[] | null {
  if (!Array.isArray(payload)) return null;

  return payload
    .filter((item) => item?.id && item?.loja && item?.nome)
    .map((item) => ({
      id: String(item.id),
      loja: String(item.loja),
      nome: String(item.nome),
      docs: {
        ...makeEmptyDocs(),
        ...(item.docs || {}),
      },
    }));
}

function buildPendingMessage(store: string, collaborators: RhCollaborator[]): string {
  const pendingCollaborators = collaborators.filter((collaborator) => !isCollaboratorValidated(collaborator));

  const rows = pendingCollaborators.map((collaborator) => {
    const docs = getPendingDocTypes(collaborator).map((doc) => doc.label).join(', ');
    return `- ${collaborator.nome}: ${docs}`;
  });

  return [
    `Olá, equipe ${store}.`,
    '',
    'Existem pendências de documentação no módulo RH do TeleFluxo.',
    '',
    ...rows,
    '',
    'Por gentileza, acessar o TeleFluxo > RH e enviar os arquivos pendentes.',
  ].join('\n');
}

export default function RhModule({ currentUser }: RhModuleProps) {
  const [collaborators, setCollaborators] = useState<RhCollaborator[]>(buildInitialCollaborators);
  const [isLoadingRh, setIsLoadingRh] = useState(false);
  const [rhApiError, setRhApiError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [selectedStore, setSelectedStore] = useState('TODAS');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('todos');
  const [openStore, setOpenStore] = useState<string | null>(null);
  const [selectedCollaboratorByStore, setSelectedCollaboratorByStore] = useState<Record<string, string>>({});
  const [notifyingStore, setNotifyingStore] = useState<string | null>(null);

  const canAdminEdit = isAdminUser(currentUser);
  const isStore = isStoreUser(currentUser);
  const userStoreName = getUserStoreName(currentUser);

  useEffect(() => {
    let isMounted = true;

    async function loadCollaborators() {
      setIsLoadingRh(true);
      setRhApiError(null);

      try {
        const query = currentUser?.id ? `?userId=${encodeURIComponent(String(currentUser.id))}` : '';
        const response = await fetch(`/api/rh/colaboradores${query}`, {
          headers: getAuthHeaders(currentUser),
        });

        if (!response.ok) {
          throw new Error('Backend do RH ainda não respondeu corretamente.');
        }

        const payload = await response.json();
        const apiCollaborators = normalizeCollaboratorsFromApi(payload);

        if (isMounted && apiCollaborators) {
          setCollaborators(apiCollaborators);
        }
      } catch (error) {
        console.error(error);
        if (isMounted) {
          setRhApiError('RH em modo local: documentos ainda dependem do backend para persistir.');
        }
      } finally {
        if (isMounted) {
          setIsLoadingRh(false);
        }
      }
    }

    loadCollaborators();

    return () => {
      isMounted = false;
    };
  }, [currentUser?.id]);

  const stores = useMemo(() => {
    return Array.from(new Set(collaborators.map((item) => item.loja))).sort((a, b) =>
      a.localeCompare(b, 'pt-BR')
    );
  }, [collaborators]);

  const visibleCollaborators = useMemo(() => {
    const normalizedQuery = normalizeText(query);

    return collaborators.filter((collaborator) => {
      const collaboratorStore = normalizeText(collaborator.loja);
      const validated = isCollaboratorValidated(collaborator);

      if (isStore && userStoreName && collaboratorStore !== userStoreName) {
        return false;
      }

      if (!isStore && selectedStore !== 'TODAS' && collaborator.loja !== selectedStore) {
        return false;
      }

      if (statusFilter === 'pendentes' && validated) {
        return false;
      }

      if (statusFilter === 'validados' && !validated) {
        return false;
      }

      if (!normalizedQuery) {
        return true;
      }

      return (
        normalizeText(collaborator.nome).includes(normalizedQuery) ||
        normalizeText(collaborator.loja).includes(normalizedQuery)
      );
    });
  }, [collaborators, query, selectedStore, statusFilter, isStore, userStoreName]);

  const groupedByStore = useMemo(() => {
    return visibleCollaborators.reduce<Record<string, RhCollaborator[]>>((acc, collaborator) => {
      if (!acc[collaborator.loja]) acc[collaborator.loja] = [];
      acc[collaborator.loja].push(collaborator);
      return acc;
    }, {});
  }, [visibleCollaborators]);

  const storeKeys = Object.keys(groupedByStore).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  const validatedCount = visibleCollaborators.filter(isCollaboratorValidated).length;
  const pendingDocs = countPendingDocs(visibleCollaborators);
  const pendingCollaboratorsCount = visibleCollaborators.filter((item) => !isCollaboratorValidated(item)).length;

  const selectPendingStore = (store: string) => {
    setSelectedStore(store);
    setStatusFilter('pendentes');
    setOpenStore(store);
  };

  const clearFilters = () => {
    setQuery('');
    setSelectedStore('TODAS');
    setStatusFilter('todos');
  };

  const handleMoveCollaborator = async (collaboratorId: string, nextStore: string) => {
    const previousCollaborators = collaborators;

    setCollaborators((current) =>
      current.map((collaborator) =>
        collaborator.id === collaboratorId
          ? { ...collaborator, loja: nextStore }
          : collaborator
      )
    );

    try {
      const response = await fetch(`/api/rh/colaboradores/${collaboratorId}/loja`, {
        method: 'PATCH',
        headers: getJsonAuthHeaders(currentUser),
        body: JSON.stringify({ loja: nextStore }),
      });

      if (!response.ok) {
        throw new Error('Falha ao atualizar a loja do colaborador.');
      }
    } catch (error) {
      console.error(error);
      setCollaborators(previousCollaborators);
      alert('Não foi possível alterar a loja do colaborador. Verifique o backend do RH.');
    }
  };

  const handleDeleteCollaborator = async (collaborator: RhCollaborator) => {
    if (!canAdminEdit) return;

    const confirmed = window.confirm(
      `Excluir o colaborador ${collaborator.nome}?\n\nEssa ação remove o colaborador da tela de RH.`
    );

    if (!confirmed) return;

    const previousCollaborators = collaborators;

    setCollaborators((current) => current.filter((item) => item.id !== collaborator.id));
    setSelectedCollaboratorByStore((current) => {
      const next = { ...current };
      if (next[collaborator.loja] === collaborator.id) {
        delete next[collaborator.loja];
      }
      return next;
    });

    try {
      const response = await fetch(`/api/rh/colaboradores/${collaborator.id}`, {
        method: 'DELETE',
        headers: getAuthHeaders(currentUser),
      });

      if (!response.ok) {
        throw new Error('Falha ao excluir colaborador.');
      }
    } catch (error) {
      console.error(error);
      setCollaborators(previousCollaborators);
      alert('Não foi possível excluir o colaborador. Verifique o backend do RH.');
    }
  };

  const handleNotifyStore = async (store: string, storeCollaborators: RhCollaborator[]) => {
    const pendingCollaborators = storeCollaborators.filter((item) => !isCollaboratorValidated(item));

    if (pendingCollaborators.length === 0) {
      alert('Essa loja não possui pendências de documentação.');
      return;
    }

    const message = buildPendingMessage(store, pendingCollaborators);
    setNotifyingStore(store);

    try {
      const response = await fetch('/api/rh/notificar-pendencias', {
        method: 'POST',
        headers: getJsonAuthHeaders(currentUser),
        body: JSON.stringify({
          loja: store,
          mensagem: message,
          colaboradores: pendingCollaborators.map((collaborator) => ({
            id: collaborator.id,
            nome: collaborator.nome,
            pendencias: getPendingDocTypes(collaborator).map((doc) => doc.label),
          })),
        }),
      });

      if (response.ok) {
        alert('Aviso de pendência enviado para a loja.');
        return;
      }

      await navigator.clipboard?.writeText(message);
      alert('Backend de aviso ainda não está ativo. A mensagem foi copiada para você enviar manualmente.');
    } catch (error) {
      console.error(error);
      try {
        await navigator.clipboard?.writeText(message);
      } catch {
        // mantém o alerta abaixo mesmo se o navegador bloquear o clipboard
      }
      alert('Não consegui enviar automaticamente. A mensagem de pendência foi preparada/copiada para envio manual, se o navegador permitir.');
    } finally {
      setNotifyingStore(null);
    }
  };

  const handleUploadDocument = async (
    collaboratorId: string,
    documentType: RhDocType,
    file?: File | null
  ) => {
    if (!file) return;

    setCollaborators((current) =>
      current.map((collaborator) =>
        collaborator.id === collaboratorId
          ? {
              ...collaborator,
              docs: {
                ...collaborator.docs,
                [documentType]: {
                  status: 'enviando',
                  fileName: file.name,
                },
              },
            }
          : collaborator
      )
    );

    const formData = new FormData();
    formData.append('file', file);
    formData.append('documentType', documentType);
    if (currentUser?.id) {
      formData.append('userId', String(currentUser.id));
    }

    try {
      const response = await fetch(
        `/api/rh/colaboradores/${collaboratorId}/documentos/${documentType}`,
        {
          method: 'POST',
          headers: getAuthHeaders(currentUser),
          body: formData,
        }
      );

      if (!response.ok) {
        throw new Error('Falha ao enviar documento.');
      }

      let uploadedUrl = '';
      if (response.ok) {
        const payload = await response.json().catch(() => null);
        uploadedUrl = payload?.url || '';
      }

      setCollaborators((current) =>
        current.map((collaborator) =>
          collaborator.id === collaboratorId
            ? {
                ...collaborator,
                docs: {
                  ...collaborator.docs,
                  [documentType]: {
                    status: 'enviado',
                    fileName: file.name,
                    uploadedAt: new Date().toISOString(),
                    url: uploadedUrl,
                  },
                },
              }
            : collaborator
        )
      );
    } catch (error) {
      console.error(error);

      setCollaborators((current) =>
        current.map((collaborator) =>
          collaborator.id === collaboratorId
            ? {
                ...collaborator,
                docs: {
                  ...collaborator.docs,
                  [documentType]: {
                    status: 'erro',
                    fileName: file.name,
                  },
                },
              }
            : collaborator
        )
      );

      alert('Não foi possível enviar o documento. Verifique o backend do RH.');
    }
  };

  return (
    <div className="flex-1 overflow-y-auto bg-slate-50 p-4 md:p-6">
      <div className="mb-5 flex flex-col gap-4 2xl:flex-row 2xl:items-end 2xl:justify-between">
        <div>
          <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-orange-50 px-3 py-1 text-[10px] font-black uppercase tracking-widest text-orange-600">
            <span className="h-2 w-2 rounded-full bg-orange-500" />
            Recursos Humanos
          </div>

          <h1 className="text-2xl md:text-3xl font-black uppercase tracking-tight text-slate-900">
            Documentação de colaboradores
          </h1>

          <p className="mt-1 max-w-4xl text-xs font-bold uppercase tracking-widest text-slate-400">
            Colaboradores à esquerda, documentação à direita. Use o filtro de pendências para cobrar as lojas rapidamente.
          </p>

          {isLoadingRh && (
            <p className="mt-2 text-[10px] font-black uppercase tracking-widest text-indigo-500">
              Carregando dados salvos do RH...
            </p>
          )}

          {rhApiError && (
            <p className="mt-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-amber-700">
              {rhApiError}
            </p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Lojas</p>
            <p className="mt-1 text-2xl font-black text-slate-900">{storeKeys.length}</p>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Colaboradores</p>
            <p className="mt-1 text-2xl font-black text-slate-900">{visibleCollaborators.length}</p>
          </div>

          <button
            type="button"
            onClick={() => setStatusFilter('validados')}
            className={`rounded-2xl border p-4 text-left shadow-sm transition hover:-translate-y-0.5 ${
              statusFilter === 'validados'
                ? 'border-emerald-300 bg-emerald-50'
                : 'border-emerald-100 bg-white'
            }`}
          >
            <p className="text-[10px] font-black uppercase tracking-widest text-emerald-500">Validados</p>
            <p className="mt-1 text-2xl font-black text-emerald-600">{validatedCount}</p>
          </button>

          <button
            type="button"
            onClick={() => setStatusFilter('pendentes')}
            className={`rounded-2xl border p-4 text-left shadow-sm transition hover:-translate-y-0.5 ${
              statusFilter === 'pendentes'
                ? 'border-red-300 bg-red-50'
                : 'border-red-100 bg-white'
            }`}
          >
            <p className="text-[10px] font-black uppercase tracking-widest text-red-500">Pendentes</p>
            <p className="mt-1 text-2xl font-black text-red-600">{pendingCollaboratorsCount}</p>
          </button>
        </div>
      </div>

      <div className="mb-5 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="grid gap-3 xl:grid-cols-[1fr_220px_190px_140px]">
          <label className="relative block">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Buscar por colaborador ou loja..."
              className="h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 pl-11 pr-4 text-xs font-bold uppercase tracking-widest text-slate-700 outline-none transition focus:border-indigo-400 focus:bg-white"
            />
          </label>

          {!isStore && (
            <select
              value={selectedStore}
              onChange={(event) => {
                setSelectedStore(event.target.value);
                if (event.target.value !== 'TODAS') setOpenStore(event.target.value);
              }}
              className="h-12 rounded-2xl border border-slate-200 bg-slate-50 px-4 text-[10px] font-black uppercase tracking-widest text-slate-600 outline-none transition focus:border-indigo-400 focus:bg-white"
            >
              <option value="TODAS">Todas as lojas</option>
              {stores.map((store) => (
                <option key={store} value={store}>
                  {store}
                </option>
              ))}
            </select>
          )}

          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
            className="h-12 rounded-2xl border border-slate-200 bg-slate-50 px-4 text-[10px] font-black uppercase tracking-widest text-slate-600 outline-none transition focus:border-indigo-400 focus:bg-white"
          >
            <option value="todos">Todos status</option>
            <option value="pendentes">Só pendentes</option>
            <option value="validados">Só validados</option>
          </select>

          <button
            type="button"
            onClick={clearFilters}
            className="flex h-12 items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 text-[10px] font-black uppercase tracking-widest text-slate-500 transition hover:bg-slate-50"
          >
            <FilterX size={15} />
            Limpar
          </button>
        </div>

        {isStore && !userStoreName && (
          <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-xs font-bold text-amber-700">
            Não consegui identificar automaticamente a loja deste usuário. Confirme se o cadastro da loja possui nome, operação ou loja preenchidos.
          </div>
        )}
      </div>

      <div className="space-y-4">
        {storeKeys.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-slate-300 bg-white p-10 text-center">
            <AlertTriangle className="mx-auto text-slate-300" size={36} />
            <h3 className="mt-3 text-lg font-black uppercase text-slate-800">
              Nenhum colaborador encontrado
            </h3>
            <p className="mt-1 text-xs font-bold uppercase tracking-widest text-slate-400">
              Ajuste os filtros ou revise o vínculo da loja do usuário.
            </p>
          </div>
        ) : (
          storeKeys.map((store) => {
            const storeCollaborators = groupedByStore[store] || [];
            const storeValidated = storeCollaborators.filter(isCollaboratorValidated).length;
            const storePendingCollaborators = storeCollaborators.filter((item) => !isCollaboratorValidated(item));
            const isOpen = openStore === store || storeKeys.length === 1;
            const selectedId = selectedCollaboratorByStore[store] || storeCollaborators[0]?.id;
            const selectedCollaborator =
              storeCollaborators.find((collaborator) => collaborator.id === selectedId) || storeCollaborators[0];

            return (
              <section key={store} className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
                <div className="flex w-full flex-col gap-3 border-b border-slate-100 bg-white p-4 text-left md:flex-row md:items-center md:justify-between">
                  <button
                    type="button"
                    onClick={() => setOpenStore(isOpen ? null : store)}
                    className="flex min-w-0 flex-1 items-center gap-3 text-left"
                  >
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600">
                      <Store size={20} />
                    </div>

                    <div className="min-w-0">
                      <h2 className="truncate text-base font-black uppercase tracking-tight text-slate-900">
                        {store}
                      </h2>

                      <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                        {storeCollaborators.length} colaboradores • {storeValidated} validados
                      </p>
                    </div>
                  </button>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => selectPendingStore(store)}
                      className="rounded-full bg-red-50 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-red-600 transition hover:bg-red-100"
                    >
                      {storePendingCollaborators.length} pendentes
                    </button>

                    {canAdminEdit && (
                      <button
                        type="button"
                        disabled={notifyingStore === store || storePendingCollaborators.length === 0}
                        onClick={() => handleNotifyStore(store, storeCollaborators)}
                        className="inline-flex items-center gap-2 rounded-full bg-slate-900 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        <BellRing size={14} />
                        {notifyingStore === store ? 'Avisando...' : 'Avisar loja'}
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => setOpenStore(isOpen ? null : store)}
                      className="rounded-full bg-slate-100 p-2 text-slate-400 transition hover:bg-slate-200"
                    >
                      <FolderOpen size={17} />
                    </button>
                  </div>
                </div>

                {isOpen && selectedCollaborator && (
                  <div className="grid gap-0 xl:grid-cols-[390px_1fr]">
                    <aside className="border-b border-slate-100 bg-slate-50/60 p-4 xl:border-b-0 xl:border-r">
                      <div className="mb-3 flex items-center justify-between gap-2">
                        <div>
                          <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                            Colaboradores
                          </p>
                          <p className="text-sm font-black uppercase text-slate-900">
                            {storeCollaborators.length} nesta visão
                          </p>
                        </div>
                        <Users size={18} className="text-slate-300" />
                      </div>

                      <div className="max-h-[620px] space-y-2 overflow-y-auto pr-1">
                        {storeCollaborators.map((collaborator) => {
                          const validated = isCollaboratorValidated(collaborator);
                          const isSelected = selectedCollaborator.id === collaborator.id;
                          const pendingCount = getPendingDocTypes(collaborator).length;

                          return (
                            <button
                              key={collaborator.id}
                              type="button"
                              onClick={() =>
                                setSelectedCollaboratorByStore((current) => ({
                                  ...current,
                                  [store]: collaborator.id,
                                }))
                              }
                              className={`w-full rounded-2xl border p-3 text-left transition hover:-translate-y-0.5 ${
                                isSelected
                                  ? 'border-indigo-300 bg-white shadow-sm ring-2 ring-indigo-50'
                                  : 'border-slate-200 bg-white hover:border-slate-300'
                              }`}
                            >
                              <div className="flex items-start gap-3">
                                <div
                                  className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
                                    validated
                                      ? 'bg-emerald-50 text-emerald-600'
                                      : 'bg-red-50 text-red-600'
                                  }`}
                                >
                                  {validated ? <CheckCircle2 size={17} /> : <AlertTriangle size={17} />}
                                </div>

                                <div className="min-w-0 flex-1">
                                  <h3 className="line-clamp-2 text-xs font-black uppercase leading-4 tracking-tight text-slate-900">
                                    {collaborator.nome}
                                  </h3>

                                  <p
                                    className={`mt-2 inline-flex rounded-full px-2 py-1 text-[8px] font-black uppercase tracking-widest ${
                                      validated
                                        ? 'bg-emerald-50 text-emerald-600'
                                        : 'bg-red-50 text-red-600'
                                    }`}
                                  >
                                    {validated ? 'Validado' : `${pendingCount} pendências`}
                                  </p>
                                </div>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </aside>

                    <div className="p-4 md:p-5">
                      <div className="mb-5 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
                        <div className="flex flex-col gap-4 2xl:flex-row 2xl:items-center 2xl:justify-between">
                          <div className="flex items-start gap-3">
                            <div
                              className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ${
                                isCollaboratorValidated(selectedCollaborator)
                                  ? 'bg-emerald-50 text-emerald-600'
                                  : 'bg-red-50 text-red-600'
                              }`}
                            >
                              <UserRound size={22} />
                            </div>

                            <div>
                              <h3 className="text-lg font-black uppercase tracking-tight text-slate-900">
                                {selectedCollaborator.nome}
                              </h3>

                              <p
                                className={`mt-1 inline-flex rounded-full px-3 py-1 text-[9px] font-black uppercase tracking-widest ${
                                  isCollaboratorValidated(selectedCollaborator)
                                    ? 'bg-emerald-50 text-emerald-600'
                                    : 'bg-red-50 text-red-600'
                                }`}
                              >
                                {isCollaboratorValidated(selectedCollaborator)
                                  ? 'Documentação validada'
                                  : 'Documentação pendente'}
                              </p>
                            </div>
                          </div>

                          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                            {canAdminEdit && (
                              <div className="flex items-center gap-2">
                                <ArrowRightLeft size={16} className="text-slate-400" />

                                <select
                                  value={selectedCollaborator.loja}
                                  onChange={(event) =>
                                    handleMoveCollaborator(selectedCollaborator.id, event.target.value)
                                  }
                                  className="h-10 min-w-[220px] rounded-xl border border-slate-200 bg-slate-50 px-3 text-[10px] font-black uppercase tracking-widest text-slate-600 outline-none focus:border-indigo-400"
                                >
                                  {stores.map((storeOption) => (
                                    <option key={storeOption} value={storeOption}>
                                      {storeOption}
                                    </option>
                                  ))}
                                </select>
                              </div>
                            )}

                            {canAdminEdit && (
                              <button
                                type="button"
                                onClick={() => handleDeleteCollaborator(selectedCollaborator)}
                                className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-red-100 bg-red-50 px-4 text-[10px] font-black uppercase tracking-widest text-red-600 transition hover:bg-red-100"
                              >
                                <Trash2 size={14} />
                                Excluir
                              </button>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="mb-3 flex items-center justify-between gap-3">
                        <div>
                          <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                            Documentação
                          </p>
                          <p className="text-sm font-black uppercase text-slate-900">
                            Envie PDF ou foto tirada pelo celular
                          </p>
                        </div>
                      </div>

                      <div className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-4">
                        {DOCUMENT_TYPES.map((doc) => {
                          const Icon = doc.icon;
                          const docState = selectedCollaborator.docs[doc.key];
                          const uploaded = docState?.status === 'enviado';
                          const sending = docState?.status === 'enviando';
                          const error = docState?.status === 'erro';

                          return (
                            <div
                              key={doc.key}
                              className={`rounded-2xl border p-4 ${
                                uploaded
                                  ? 'border-emerald-100 bg-emerald-50/50'
                                  : error
                                    ? 'border-red-200 bg-red-50'
                                    : 'border-slate-200 bg-slate-50'
                              }`}
                            >
                              <div className="mb-3 flex items-center justify-between gap-2">
                                <div className="flex items-center gap-2">
                                  <Icon size={17} className={uploaded ? 'text-emerald-600' : 'text-slate-400'} />
                                  <span className="text-[10px] font-black uppercase tracking-widest text-slate-600">
                                    {doc.label}
                                  </span>
                                </div>

                                {uploaded ? (
                                  <FileCheck2 size={16} className="text-emerald-600" />
                                ) : (
                                  <AlertTriangle size={16} className={error ? 'text-red-600' : 'text-red-400'} />
                                )}
                              </div>

                              {docState?.fileName ? (
                                <p className="mb-2 truncate text-[10px] font-bold text-slate-500">
                                  {docState.fileName}
                                </p>
                              ) : (
                                <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-red-400">
                                  Arquivo pendente
                                </p>
                              )}

                              {docState?.uploadedAt && (
                                <p className="mb-2 text-[9px] font-black uppercase tracking-widest text-emerald-600">
                                  Enviado em {formatDate(docState.uploadedAt)}
                                </p>
                              )}

                              <label className="flex h-11 cursor-pointer items-center justify-center gap-2 rounded-xl bg-slate-900 px-3 text-[10px] font-black uppercase tracking-widest text-white transition hover:bg-slate-800 active:scale-95">
                                <Upload size={14} />
                                {sending ? 'Enviando...' : uploaded ? 'Substituir' : 'Enviar'}
                                <input
                                  type="file"
                                  accept="application/pdf,image/*"
                                  capture="environment"
                                  className="hidden"
                                  disabled={sending}
                                  onChange={(event) =>
                                    handleUploadDocument(
                                      selectedCollaborator.id,
                                      doc.key,
                                      event.target.files?.[0]
                                    )
                                  }
                                />
                              </label>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}
              </section>
            );
          })
        )}
      </div>
    </div>
  );
}
