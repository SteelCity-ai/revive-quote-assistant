import {parentPort, workerData} from 'node:worker_threads';
import {PDFiumLibrary} from '@hyzyla/pdfium';
try {
  const library=await PDFiumLibrary.init();
  const doc=await library.loadDocument(new Uint8Array(workerData));
  if(doc.getPageCount()>30) throw new Error('Use an estimate with at most 30 pages.');
  let text='';
  for(const page of doc.pages()) {
    text+=page.getText()+'\n';page.close();
    if(text.length>80000) throw new Error('The estimate contains too much text.');
  }
  doc.destroy();library.destroy();
  parentPort.postMessage({text});
} catch { parentPort.postMessage({error:'This PDF could not be read. Use an unlocked, text-based Symplewyse estimate (at most 30 pages).'}); }
