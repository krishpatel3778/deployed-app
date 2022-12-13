var express=require("express");
var axios=require('axios');
var cheerio=require('cheerio');
var fs=require('fs')
// var { aws4Interceptor } = require("aws4-axios");
// const interceptor = aws4Interceptor({
//   region: "us-east-2c",
//   service: "execute-api",
// });
// axios.interceptors.request.use(interceptor);
const PDFMerger = require('pdf-merger-js');
var router=express.Router();
var currentString="  "
router.get("/",function(req,res){
  res.sendFile("/home/ec2-user/back-end/deployed-app/form.html")
})
router.get("/parser",function(req,res){
  var url=req.url;
  console.log(url);
  var data=[];
  for(var i=0;i<url.length;i++){
    if(url.substring(i,i+1)=="="){
      var word=""
      for(var x=i+1;x<url.length;x++){
        var toAdd=url.substring(x,x+1);;
        if(toAdd=="&"||x==url.length-1){
          if(x==url.length-1){
            data.push(word+toAdd)
          }else{
            data.push(word)
          }
          break;
        }
        word+=toAdd;
      }
    }
  }
  var queryString=`${data[0]}/"${data[1]}" AND ABST/${data[2]} AND ISD/${data[3]}->${data[4]} ^^^ ${data[5].replace("%2C",",")} ^^^ ${data[6]}`
  res.redirect(`/pdf?query=${queryString}`)
})
router.get("/pdf",function(req,res){
  var query=req.url.split("?query=")[1];
  if(query===undefined||query.replace(/[a-zA-Z]/ig,"")==query){
    res.send("Invalid query provided")
  }else{
    currentString="";

    var parts=decodeURI(query).split("^^^");
    res.sendFile("/home/ec2-user/back-end/deployed-app/running.html");
    freePatents(parts[0],parts[1],parts[2]);
    //PEX/smith AND ABST/glass AND ISD/NOW-1YEAR->NOW
  }
})
router.get("/status",function(req,res){
  res.set('Content-type',"text/plain")
  res.send(Buffer.from(currentString))
})
router.get("/getpdf",function(req,res){
  res.sendFile("/home/ec2-user/back-end/deployed-app/pdfBuffer.pdf")
})
var app=express();
app.use(router);
app.set("port",process.env.PORT||5000);
app.listen(app.get("port"),function(){
  console.log("server start on port "+ app.get("port"))
})
async function freePatents(queryString,outputConfig,needExtra){
  var page=1;
  var allCodes=[];
  while(true){
    var url=`https://www.freepatentsonline.com/result.html?p=${page}&srch=xprtsrch&query_txt=${encodeURI(queryString)}&uspat=${outputConfig.split(",")[0]}&usapp=${outputConfig.split(",")[1]}&date_range=all&stemming=on&sort=relevance&search=Search`;
    console.log(url);
    var $=await loadPage(url);
    try{
      console.log("<br>"+$('#results > div.well.well-small > table > tbody > tr > td:nth-child(1)').text())
      currentString+="<br>"+$('#results > div.well.well-small > table > tbody > tr > td:nth-child(1)').text();
      var array=$("tr>td:nth-child(3)>a")
      for(var i=1;i<array.length-2;i++){
        try{
          var $1=await loadPage("https://www.freepatentsonline.com"+$(array[i]).attr("href"))
          var array1=$1(".disp_elm_title,.disp_elm_text");
          for(var x=0;x<array1.length;x++){
            if($1(array1[x]).text()=="Application Number:"){
              allCodes.push($1(array1[x+1]).text());
              break;
            }
          }
        }catch{
        }
      }

      if(array.length==0){
        break;
        currentString+= "<br>"+"No results found";
      }
      page++;
    }catch(error){
      page--;
    }
  }
  patentSearcher(allCodes,needExtra)
}
function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  })
}
async function patentSearcher(codeArray,needExtra){
  var set=new Set(codeArray);
  codeArray=Array.from(set);
  var individualPDFS=[];
  var pdfNum=0;
  for(var i=0;i<codeArray.length;i++){
    currentString+="<br>"+"Case Number: "+(i+1);
    var number=codeArray[i].replaceAll(/\D/ig,"");
    var res=await getPage(`https://patentcenter.uspto.gov/retrieval/public/v2/application/data?applicationNumberText=${number}`);
    try{
      var status=res.data.applicationMetaData.applicationStatusDescriptionText;
    }catch{
      var status=""
    }
    //currentResponse.send(status);
    if(status=="Patented Case"){
      var dataCodes=await getPage(`https://patentcenter.uspto.gov/retrieval/public/v1/applications/sdwp/external/metadata/${number}`);
      try{
        var allData=dataCodes.data.resultBag[0].documentBag;
      }catch{
        var allData=[];
      }
      var acceptCondition=false;
      var codesToAccept=["CLM","REM","AME","A."];
      if(needExtra=="true"){
        codesToAccept.push("CTFR")
        codesToAccept.push("CTNF")
      }
      for(var x=0;x<allData.length;x++){
        var code=allData[x].documentCode;
        if(code=="NOA"){
          acceptCondition=true;
        }
        if(acceptCondition&&codesToAccept.indexOf(code)!=-1){
          var pdf=await axios.request({
              method: 'GET',
              url: `https://patentcenter.uspto.gov/retrieval/public/v2/applications/${number}/documents/${allData[x].documentIdentifier}?type=pdf`,
              responseType: 'arraybuffer',
              responseEncoding: 'binary'
          });
          individualPDFS.push(pdf.data);
        }
      }
    }
  }
  var merger = new PDFMerger();
  for(var u=0;u<individualPDFS.length;u++){
    await merger.add(individualPDFS[u]);
  }

  await merger.save("pdfBuffer.pdf")
  currentString="redirect";
}
function loadPage(url){
	try{
	// const a= await axios.get(url,{
  //   headers:{
  //     cookie: "__utmc=211553730; __utmz=211553730.1670900785.1.1.utmcsr=(direct)|utmccn=(direct)|utmcmd=(none); __gads=ID=a3426d1ee56f0c74-22c965423dd8008b:T=1670900785:RT=1670900785:S=ALNI_MacPb8uZEqC-5HaqsRf6GPw9pujGQ; __gpi=UID=00000911a253a552:T=1670900785:RT=1670900785:S=ALNI_MZ0OuQCb-wPnSm926SYdvCSQLcqPw; SESS8454a07f9=0Umx_7prGRTySRACqDOjxqg; __utma=211553730.849944579.1670900785.1670902985.1670906559.3; _cbpt=czoxNzoidjQ7NDswOzE2NzA5MDY5NjYiOw=="
  //   }
  // });
	// return await cheerio.load(a.data);
    const http = require('http');
    const crawlbaseToken = 'JJLUQ3kLZDDuzPcaFtAW3w';
    const auth = `Basic ${Buffer.from(crawlbaseToken).toString('base64')}`;
    var text=""
// Example of HTTP request
    http
      .get(
        {
          host: 'smartproxy.crawlbase.com',
          port: 8012,
          path: 'https://www.freepatentsonline.com/result.html?p=1&srch=xprtsrch&query_txt=PEX/%22Smith%22%20AND%20ABST/Glass%20AND%20ISD/2016-03-02-%3E2022-12-12%20&uspat=%20on&usapp=off%20&date_range=all&stemming=on&sort=relevance&search=Search',
          headers: {
            'Proxy-Authorization': auth,
            // 'crawlbaseAPI-Parameters': 'javascript=true' // Send the javascript param if you need to do requests using headless browsers.
          },
        },
        (res) => {
          const chunks = [];
          res.on('data', (chunk) => chunks.push(chunk));
          res.on('end', () =>{
              console.log('DONE HTTP Request', Buffer.concat(chunks).toString('utf8'))
              text=Buffer.concat(chunks).toString('utf8');
              return text;
            }
          );
        }
      )
      .on('error', console.error)
      .end();
	}catch(error){
    console.log(error);
		//currentResponse.send(url);
		//await sleep(30000);
	}
}
async function getPage(url){
	try{
  	const a= await axios.get(url);
  	return a;
	}catch(error){
		//currentResponse.send(url);
    await sleep(15000);
	}
}
