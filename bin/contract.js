#!/usr/bin/env node
import {openSync,readSync,closeSync,fstatSync,constants} from 'node:fs';
import {auditContract,compareContract} from '../src/contract.js';
const USAGE='Usage: format-inspector-contract --profile rules.json --input current.csv [--previous previous.csv]\nExit 0: current file passes; 1: current file fails; 2: input error. JSON report only.\n';
function read(path,limit){
 const fd=openSync(path,constants.O_RDONLY|constants.O_NONBLOCK);
 try{
  if(!fstatSync(fd).isFile())throw new TypeError("regular file required");
  const buf=Buffer.alloc(limit+1);let n=0;
  while(n<buf.length){const r=readSync(fd,buf,n,buf.length-n,null);if(!r)break;n+=r;}
  if(n>limit)throw new RangeError('too large');
  return new TextDecoder('utf-8',{fatal:true}).decode(buf.subarray(0,n));
 }finally{closeSync(fd);}
}
try{
 const args=process.argv.slice(2);
 if(args.length===1&&['--help','-h'].includes(args[0]))process.stdout.write(USAGE);
 else{
  const opt=new Map();
  for(let i=0;i<args.length;i+=2){const key=args[i],value=args[i+1];if(!['--profile','--input','--previous'].includes(key)||!value||value.startsWith('--')||opt.has(key))throw new Error('invalid options');opt.set(key,value);}
  if(!opt.has('--profile')||!opt.has('--input'))throw new Error('missing options');
  const profile=read(opt.get('--profile'),16384),csv=read(opt.get('--input'),1048576);
  const result=opt.has('--previous')?compareContract(read(opt.get('--previous'),1048576),csv,profile):auditContract(csv,profile);
  process.stdout.write(JSON.stringify(result,null,2)+'\n');
  if(!result.valid)process.exitCode=1;
 }
}catch{process.stderr.write('Contract audit: invalid input, unreadable file, or policy limit exceeded\n');process.exitCode=2;}
