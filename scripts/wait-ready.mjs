const urls=process.argv.slice(2);const deadline=Date.now()+300000;
for(const url of urls){let ready=false;while(Date.now()<deadline){try{const response=await fetch(url,{signal:AbortSignal.timeout(10000)});if(response.ok){ready=true;console.log('Ready:',url);break;}}catch{}await new Promise(r=>setTimeout(r,1500));}if(!ready){console.error('Not ready:',url);process.exit(1);}}
