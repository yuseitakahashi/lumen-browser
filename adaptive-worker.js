'use strict';
importScripts('adaptive-core.js?v=20261105-candidate2');
self.onmessage=({data})=>{try{const t=performance.now();const result=AdaptiveCore.analyze(data.patches,data.compression);postMessage({result,workerMs:performance.now()-t});}catch(e){postMessage({error:String(e.message||e)});}};
