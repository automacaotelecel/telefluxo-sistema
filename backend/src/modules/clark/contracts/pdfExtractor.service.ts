import pdfParse from 'pdf-parse';

export class PdfExtractorService {
  public async extractTextFromBuffer(
    pdfBuffer: Buffer
  ): Promise<string> {
    try {
      if (!pdfBuffer || pdfBuffer.length === 0) {
        throw new Error('Buffer PDF vazio.');
      }

      console.log(
        `[PdfExtractor] Iniciando extração. Tamanho: ${pdfBuffer.length} bytes`
      );

      const data = await pdfParse(pdfBuffer);

      const cleanText = (data.text || '')
        .replace(/\r\n/g, '\n')
        .replace(/\n\s*\n/g, '\n')
        .replace(/\s{2,}/g, ' ')
        .trim();

      if (!cleanText) {
        throw new Error(
          'Nenhum texto encontrado. O PDF pode ser escaneado.'
        );
      }

      console.log(
        `[PdfExtractor] Extração concluída. ${cleanText.length} caracteres encontrados.`
      );

      return cleanText;
    } catch (error) {
      console.error('[PdfExtractor] Erro:', error);
      throw error;
    }
  }
}

export const pdfExtractorService = new PdfExtractorService();