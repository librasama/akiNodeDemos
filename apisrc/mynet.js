var net = require('net');

/**
 *  net 的服务端demo。
 *  createServer签名是net.createServer([options], connectionListener);
 *  其中option可以是 {allowHalfOpen:false, pauseOnConnect:false}
 *  通过telnet localhost 8124 客户端可进行测试，win7、8如telnet找不到命令，可前往控制面板->程序->开启windows功能中设置开启telnet客户端。
 *
 *
  */
var server = net.createServer(function (c) {
    console.log("client connected");
    c.on('end', function () {
        console.log("client disconnected");
    });
    c.write('hello\r\n');
    c.pipe(c);
});

// 也可以直接监听socket而不是端口。写法如下
// server.listen('/tmp/echo.sock', function(){'listening ' listener});
server.listen(8124, function(){
    var address = server.address();
    console.log("opened server on %j", address);
    console.log("server bound");
});


//哦，win下这酸爽谜一般的path指的是domain socket。到底什么鬼？
/*server.listen(path.join('\\\\?\\pipe', process.cwd(), 'myctl'), function () {
    console.log("server bound");
});*/



/**
 * net 的客户端demo
 * net.createConnection和net.connect一样的。签名如下：
 * net.connect(options[, connnectionListener]);
 *
 * 选项如下：
 * port,host,localAddress,localPort,family(4/6，默认4)
 * allowHalfOpen=true时，当接收到另外一边的FIN包时，不会主动发送FIN包。默认为false
 *
 */
// end 事件居然让server端先捕捉到？？？


var client = net.connect({port:8124}, function () {
    console.log("connected to server!");
    client.write('world!');
});
client.on('data', function(data){
    console.log(data.toString());
    client.end();
});
client.on('end', function () {
    console.log("disconnected from server");
});


/***
 *
 * 类 net.Server
 * 这个用来创建TCP或者本地的Server(伺服器啦)
 *
 * 花式监听
 *      server.listen:
 *      server.listen(port[,host][,backlog][,callback]);
 *      server.listen(path[,callback])
 *      server.listen(handle[,callback]);
 *      server.listen(options[,callback]);
 *
 * 关于开始监听：
 *      <b>第一个：</b>
 *      backlog这个参数呢，是指挂起的连接队列的最大长度。这个实际值取决于你的操作系统，比如说在linux上就是指sysctl的tcp_max_syn_backlog或者somaxconn。默认是511（不是512（什么鬼
 *      这个是异步的大家都懂……总之callback就是监听到listening事件才执行的回调。
 *      一个常遇到的问题就是EADDRINUSE错误，地址占用嘛。就是说在你指定的那个端口上另外一个服务器正跑着呢。一个解决办法就定时轮询尝试，代码如下~~下~~下~~
 *
 *
 *      <b>第二个</b>
 *      讲真，第二个监听path的什么鬼啊？local domain(？)
 *      unix就普通文件就OK，当unlink的时候会presist。
 *      在win下使用一个命名管道named pipe实现local domain。总之必须要\\?pipe\或者\\.pipe\.这样命名才行哪。pipes不会持久化，关了就没了。js对于\符号需要转义，所以看起来就像是\\\\?pipe\\这样的
 *
 *      <b>第三个</b>
 *      这个handle对象可以是一个server或者socket（任何包含_handle成员的实现），或者{fd:<n>}这样的对象.    （根本看不懂侯吗？？！应该是unix进程通信的一些东东
 *      总之，会让server一些指定的handle上接受连接,但是需要在这个fd或者handle已经被绑定在某个端口或者domain socket的前提下。
 *      win上不支持fd上的监听啦。（呵
 *
 *      <b>第四个</b>
 *      集大成者吧。可配置选项如下
 *      {port, host, backlog, path, exclusive}。前四个和第一个方式一样。第五个exclusive是cluster集群使用的。
 *      当exclusive=true时，标志着任务不能被分享。cluster worker
 *
 *
 * 关闭服务器
 * server.close(callback);
 *
 * 服务器地址：
 * server.address()---->返回值长成这个样子{"address":"::","family":"IPv6","port":8124}
 *
 * 解除引用(?)
 * server.unref();
 * 如果这个服务器是事件系统里唯一活着的，又被call了unref()、程序将退出。如果已经unref了再unref没什么效果。
 *
 * 增加引用
 * 和unref相反了，不让唯一的server退出，在refd上再ref没效果。
 *
 * 最大连接数：
 * server.maxConnections
 * 设置了这个当超过了指定数值的时候，服务器拒绝连接。当socket已经发送给用child_process.fork产生的child子进程时，不建议使用这个参数。（为什么？？？？！！！！）
 *
 * 所有连接个数：
 * server.connections(callback)------> callback有两个参数哟，err和count
 *
 *
 *
 * 会~~发射~~的事件：
 * listening    :   当调用server.listen后，server被绑定时发送'listening'
 * connection   :   当有新连接时。发送connetion。
 * close        :   server关闭时，如果还有连接，当这些connection结束之前是不会发送close事件的~~
 * err          :   有错误发生时发射~~，error后直接触发close事件。
 *
 */

// 看我1s轮询重试端口。（不太好。端口占用一般都要手动杀掉（x
server.on('error', function (e) {
    if(e.code == 'EADDRINUSE') {
        console.log("Address in use, retrying...");
        setTimeout(function () {
            server.close();
            server.listen(PORT, HOST);
        }, 1000);
    }
});


/**
 * 类 net.Socket
 * 这个是TCP或者本地socket的抽象。Socket示例实现了duplex stream也就是双工流。就是说既可以被调用者创建为客户端（使用connect()），又能够被Node开发为发送'connection'事件给用户的服务端
 *
 * 构造方法：new Socket([options])
 * options 默认如下：
 * {
 *      fd:null,
 *      allowHalfOpen:false,
 *      readable:false,
 *      writable:false
 * }
 *
 * fd 让你指定已经存在的socket的文件描述符啦。只有当fd指定的时候，readable/writable才生效，这俩参为了读写socket。
 *
 * allowHalfOpen这参数和server结束时发送end事件的表现有关。（...）
 *
 *
 *
 *
 *
 *
 *
 *
 *
 *
 *
 */