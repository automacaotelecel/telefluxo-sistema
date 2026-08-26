# Telecel — Conferência de IMEIs

Sistema React/Vite para importar uma planilha de estoque, bipar IMEIs e conferir automaticamente aparelhos encontrados, pendentes, divergentes, duplicados e inválidos.

O fluxo operacional é direto: importe a planilha, abra **Bipar aparelhos** e faça as leituras. Cada IMEI é comparado imediatamente com o controle ativo e registrado com data, hora, operador e resultado.

## Instalação

Requisitos: Node.js 20.19 ou superior.

```bash
npm install
npm run dev
```

Abra o endereço exibido no terminal. Em uma instalação padrão do Vite, normalmente será `http://localhost:5173`.

Para validar a versão que será publicada:

```bash
npm run lint
npm run build
```

## Corrigir a pasta atual no Windows

Se você copiar estes arquivos sobre a pasta que apresentou o erro de PostCSS, execute `CORRIGIR_E_INICIAR.bat`. Ele:

1. confirma que está dentro do projeto `bipador-aparelhos`;
2. remove somente os arquivos estranhos que foram misturados ao Vite;
3. reinstala as dependências;
4. inicia o sistema.

O script não remove a pasta `.git`, portanto o histórico do repositório é preservado.

## Planilha de teste

Use `exemplos/modelo-controle-imeis.csv`. Também são aceitos arquivos `.csv` e `.xlsx`; a coluna de IMEI pode aparecer como `IMEI`, `IMEI 1`, `IMEI1`, `Serial` ou `Número de série`.

## Dados desta primeira etapa

As conferências ficam salvas no navegador do aparelho por meio de armazenamento local. A integração com o estoque central pode ser adicionada posteriormente sem reconstruir a interface.

## Câmera

O leitor por câmera precisa de permissão do navegador. Fora do computador local, a página deve ser publicada em HTTPS.

Na tela **Bipar aparelhos → Usar câmera**, o sistema permite:

- escolher qualquer câmera informada pelo celular ou computador;
- alternar rapidamente entre as câmeras;
- memorizar a câmera escolhida para o próximo acesso;
- priorizar automaticamente a câmera traseira/principal;
- usar os modos **Normal** e **Código pequeno**;
- analisar simultaneamente o quadro completo e um recorte central de precisão;
- manter foco, exposição e balanço de branco contínuos quando suportados;
- controlar lanterna e zoom nos aparelhos compatíveis;
- mostrar em tempo real que o decodificador está analisando a imagem;
- emitir bip, vibração e flash visual assim que um código for reconhecido;
- testar o retorno do aparelho pelo botão **Testar bip e vibração**;
- mostrar abaixo da câmera o último código realmente decodificado, inclusive quando for ignorado;
- extrair números de 15 dígitos e compará-los diretamente com o controle importado;
- ignorar EANs e outros códigos que não contenham IMEI;
- bloquear leituras repetidas causadas pelo mesmo código parado diante da câmera.

Se os nomes das câmeras não aparecerem inicialmente, pressione **Iniciar câmera** e aceite a permissão. Os nomes serão atualizados após a autorização.

A vibração depende do suporte oferecido pelo aparelho e pelo navegador. Quando ela não estiver disponível, o bip e o flash colorido continuam confirmando a leitura.

### Como confirmar que está lendo

1. O indicador **Leitor analisando a imagem** deve mostrar a resolução e aumentar o número de quadros analisados.
2. Assim que qualquer etiqueta for decodificada, o conteúdo aparece em **Último código capturado pela câmera**.
3. Um IMEI de 15 dígitos é comparado com a planilha. EAN ou outro código aparece como **Ignorado**, sem ficar invisível.

Se os quadros aumentarem, mas nenhum código aparecer, troque para **Código pequeno**, mantenha a etiqueta reta, use boa iluminação e selecione a câmera traseira principal.

## Aplicativo no celular

O projeto é um PWA instalável. Depois de publicado em HTTPS, use o botão **Instalar app** no cabeçalho:

- no Android/Chrome, o navegador abre a instalação diretamente quando disponível;
- no iPhone/Safari, siga **Compartilhar → Adicionar à Tela de Início**;
- quando o navegador não libera a instalação automática, o sistema mostra as instruções adequadas.

A versão mobile possui navegação inferior, botões maiores para toque, campos preparados para iPhone/Android e câmera dimensionada para a tela do aparelho. Os relatórios continuam disponíveis em **Baixar**, com exportação da conciliação e do log de bipagens em CSV.
