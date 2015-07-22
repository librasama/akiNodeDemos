var net = require('net');

/**
 *  net �ķ����demo��
 *  createServerǩ����net.createServer([options], connectionListener);
 *  ����option������ {allowHalfOpen:false, pauseOnConnect:false}
 *  ͨ��telnet localhost 8124 �ͻ��˿ɽ��в��ԣ�win7��8��telnet�Ҳ��������ǰ���������->����->����windows���������ÿ���telnet�ͻ��ˡ�
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

// Ҳ����ֱ�Ӽ���socket�����Ƕ˿ڡ�д������
// server.listen('/tmp/echo.sock', function(){'listening ' listener});
server.listen(8124, function(){
    var address = server.address();
    console.log("opened server on %j", address);
    console.log("server bound");
});


//Ŷ��win������ˬ��һ���pathָ����domain socket������ʲô��
/*server.listen(path.join('\\\\?\\pipe', process.cwd(), 'myctl'), function () {
    console.log("server bound");
});*/



/**
 * net �Ŀͻ���demo
 * net.createConnection��net.connectһ���ġ�ǩ�����£�
 * net.connect(options[, connnectionListener]);
 *
 * ѡ�����£�
 * port,host,localAddress,localPort,family(4/6��Ĭ��4)
 * allowHalfOpen=trueʱ�������յ�����һ�ߵ�FIN��ʱ��������������FIN����Ĭ��Ϊfalse
 *
 */
// end �¼���Ȼ��server���Ȳ�׽��������


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
 * �� net.Server
 * �����������TCP���߱��ص�Server(�ŷ�����)
 *
 * ��ʽ����
 *      server.listen:
 *      server.listen(port[,host][,backlog][,callback]);
 *      server.listen(path[,callback])
 *      server.listen(handle[,callback]);
 *      server.listen(options[,callback]);
 *
 * ���ڿ�ʼ������
 *      <b>��һ����</b>
 *      backlog��������أ���ָ��������Ӷ��е���󳤶ȡ����ʵ��ֵȡ������Ĳ���ϵͳ������˵��linux�Ͼ���ָsysctl��tcp_max_syn_backlog����somaxconn��Ĭ����511������512��ʲô��
 *      ������첽�Ĵ�Ҷ���������֮callback���Ǽ�����listening�¼���ִ�еĻص���
 *      һ�����������������EADDRINUSE���󣬵�ַռ�������˵����ָ�����Ǹ��˿�������һ���������������ء�һ������취�Ͷ�ʱ��ѯ���ԣ���������~~��~~��~~
 *
 *
 *      <b>�ڶ���</b>
 *      ���棬�ڶ�������path��ʲô����local domain(��)
 *      unix����ͨ�ļ���OK����unlink��ʱ���presist��
 *      ��win��ʹ��һ�������ܵ�named pipeʵ��local domain����֮����Ҫ\\?pipe\����\\.pipe\.�������������ġ�pipes����־û������˾�û�ˡ�js����\������Ҫת�壬���Կ�����������\\\\?pipe\\������
 *
 *      <b>������</b>
 *      ���handle���������һ��server����socket���κΰ���_handle��Ա��ʵ�֣�������{fd:<n>}�����Ķ���.    ���������������𣿣���Ӧ����unix����ͨ�ŵ�һЩ����
 *      ��֮������serverһЩָ����handle�Ͻ�������,������Ҫ�����fd����handle�Ѿ�������ĳ���˿ڻ���domain socket��ǰ���¡�
 *      win�ϲ�֧��fd�ϵļ�����������
 *
 *      <b>���ĸ�</b>
 *      ������߰ɡ�������ѡ������
 *      {port, host, backlog, path, exclusive}��ǰ�ĸ��͵�һ����ʽһ���������exclusive��cluster��Ⱥʹ�õġ�
 *      ��exclusive=trueʱ����־�������ܱ�����cluster worker
 *
 *
 * �رշ�����
 * server.close(callback);
 *
 * ��������ַ��
 * server.address()---->����ֵ�����������{"address":"::","family":"IPv6","port":8124}
 *
 * �������(?)
 * server.unref();
 * ���������������¼�ϵͳ��Ψһ���ŵģ��ֱ�call��unref()�������˳�������Ѿ�unref����unrefûʲôЧ����
 *
 * ��������
 * ��unref�෴�ˣ�����Ψһ��server�˳�����refd����refûЧ����
 *
 * �����������
 * server.maxConnections
 * �����������������ָ����ֵ��ʱ�򣬷������ܾ����ӡ���socket�Ѿ����͸���child_process.fork������child�ӽ���ʱ��������ʹ�������������Ϊʲô������������������
 *
 * �������Ӹ�����
 * server.connections(callback)------> callback����������Ӵ��err��count
 *
 *
 *
 * ��~~����~~���¼���
 * listening    :   ������server.listen��server����ʱ����'listening'
 * connection   :   ����������ʱ������connetion��
 * close        :   server�ر�ʱ������������ӣ�����Щconnection����֮ǰ�ǲ��ᷢ��close�¼���~~
 * err          :   �д�����ʱ����~~��error��ֱ�Ӵ���close�¼���
 *
 */

// ����1s��ѯ���Զ˿ڡ�����̫�á��˿�ռ��һ�㶼Ҫ�ֶ�ɱ����x
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
 * �� net.Socket
 * �����TCP���߱���socket�ĳ���Socketʾ��ʵ����duplex streamҲ����˫����������˵�ȿ��Ա������ߴ���Ϊ�ͻ��ˣ�ʹ��connect()�������ܹ���Node����Ϊ����'connection'�¼����û��ķ����
 *
 * ���췽����new Socket([options])
 * options Ĭ�����£�
 * {
 *      fd:null,
 *      allowHalfOpen:false,
 *      readable:false,
 *      writable:false
 * }
 *
 * fd ����ָ���Ѿ����ڵ�socket���ļ�����������ֻ�е�fdָ����ʱ��readable/writable����Ч��������Ϊ�˶�дsocket��
 *
 * allowHalfOpen�������server����ʱ����end�¼��ı����йء���...��
 *
 * ~~~~~~һЩ��Ҫ����~~~~~
 *
 *
 * ��������
 * socket.connect(port[,host][,connectListener]);
 * socket.connect(path[,connectListener]);
 * ������createServerһ��������path�Ǹ��ɣ�����unix��������á�
 * �������˻ᴥ��connect�¼����쳣�˾ʹ���error�¼���
 *
 *
 * ��������С
 * socket.bufferSize
 * ������������������塣���Լ���С֮�����������ʹ��resume(),pause().
 *
 * ���ñ��뼯
 * socket.setEncoding([encoding]);
 * Ĭ��utf8�����ο�stream.setEncoding()
 *
 * д����
 * socket.write(data [,encoding][, callback])
 * �ڶ����������string��Ĭ��Ϊutf8.
 * д����kernel buffer�ͷ���true�����������ڴ治�㱻������ûд�궼����false��������buffer���������ݵ�ʱ�򴥷�drain�¼���
 * callback��data������д���ʱ�򱻴����ģ����첽������
 *
 * ���������
 * socket.end([data][,encoding])
 * ��һ��FIN��������֮ǰ���ܻ����͵�data��
 *
 * socket.destory();
 * ��֤֮ǰû�л���ˡ�һ����error������ʱ��Ż�����ء�
 *
 * socket.pause();
 * ��ͣ��ȡ���ݣ�����˵����pause��Ͳ��ᴥ��data�¼��á������ϴ������á�
 *
 * socket.resume();
 * pause()�������ûɶ��˵��
 *
 * ���ó�ʱ
 * socket.setTimeout(timeout[,callback])
 * ����socket����ν��ʱ�ģ���Ϊ�˽�Լ��Դso����֮ʱ�䵽�˻ᴥ��һ��timeout�¼��������ֶ�����end()����destroy()��timeout=0�Ļ���existing idle timeout�ᱻͣ�ã�����������
 *
 * ��ֹNagle�㷨��
 * socket.setNoDelay([noDelay]);
 * Ĭ��TCP������Nagle�㷨������buffer������С����������Ϊtrue��ֱ��socket.write��
 *
 * ���ֳ����ӣ�����
 * socket.setKeepAlive([enable][,initalDelay])
 * �Ƿ��������ӣ�Ĭ�ϲ������ġ�
 *
 * socket.unref()/socket.ref()
 * ������
 *
 * socket.remoteAddress/socket.remotePort/socket.localAddress/socket.localPort
 * �ͻ��ˡ�������������IP��ַ���˿�/21 or 80
 *
 * socket.bytesRead/byteWritten
 * �Ѿ����յ�/���͵��ֽ���
 *
 *
 * *********����¼�***********
 *
 * lookup:
 * dns ������ɵ���û���ӵ�ʱ�̷���~
 *
 * connect:
 * ���ӳɹ�ʱ����~
 *
 * data:
 * ���յ�����ʱ����~�����п�����Buffer����String,��socket.setEncoding���б��룬�����쳯�˿��ܻ���ҪiconvŶ�Ǻǡ��ο�Readable Stream��ȡ����Ŷ
 * ���棬��socket����data�¼���ȴ����data�¼�û��ָ���ص����������ݾ͵��ˣ����Լ����Ű�~~��
 *
 * end:
 * socketʱ��ʱ��������ȫ��allowHalfOpen���������true�Ͳ�����end() (��ʵû��̫��
 *
 * timeout:
 * ��֪ͨһ�����˺ܾã�Ҫclose()�Լ�����
 *
 * drain:
 * ��write buffer�ֿ��˵�ʱ���͡���������Ŷ~
 *
 * error:
 * ������
 *
 * close:
 * had_error ��־��û�д���
 *
 */

/**
 *
 * net.isIP(input)  0 ����Ƿ����룬4����ipv4, 6����ipv6
 * net.isIPv4(input)
 * net.isIPv6(input)
 *
 */

