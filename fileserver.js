// fileserver
var bodyParser = require('body-parser');
var fileDriver = require('./fsDriver.js');
var url = require('url');
var mime = require('mime');
var path = require('path');
/* used to modify format out output of data;
   input of function is full filepath
*/
var modifyOut = null;
var fileserver = function(app) {
  if (!app) {
    throw new Error('express app required');
  }

  app.use(bodyParser());
  app.get("/*/", getDir);
  app.get("/*", getFile);
  app.post("/*", postFileOrDir);
  app.put("/*", putFileOrDir);
  app.del("/*/", delDir);
  app.del("/*", delFile);
  app.use(function (err, req, res, next)  {
    res.send(500, err);
  });
  app.setModifyOut = function(func) {
    if (typeof func !== 'function') {
      throw new Error('should be function');
    }
    modifyOut = func;
  };
  app.unsetModifyOut = function(func) {
    modifyOut = null;
  };
  return app;
};

/* GET
  /path/to/dir/
  list contents of directory

  *optional*
  ?recursive = list recursively default false

  return:
  [
    {
      "name" : "file1", // name of dir or file
      "path" : "/path/to/file", // path to dir or file
      "dir" : false // true if directory
    },
  ]
*/
var getDir = function (req, res, next) {
  var dirPath =  decodeURI(url.parse(req.url).pathname);
  var isRecursive = req.query.recursive || "false";

  var handList = function (err, files) {
    if (err) {
      // this this is a file, redirect to file path
      if (err.code === 'ENOTDIR') {
        var originalUrl = url.parse(req.originalUrl);
        originalUrl.pathname = originalUrl.pathname.substr(0, originalUrl.pathname.length - 1);
        var target = url.format(originalUrl);
        res.statusCode = 303;
        res.setHeader('Location', target);
        res.end('Redirecting to ' + target);
        return;
      }
      return next(err);
    }
    for (var i = files.length - 1; i >= 0; i--) {
      files[i] = formatOutData(files[i]);
    }
    res.json(files);
  };

  if (isRecursive === "true") {
    return fileDriver.listAll(dirPath, false, handList);
  } else {
    return fileDriver.list(dirPath, handList);
  }
};

/* GET
  /path/to/file
  return contents of file
  if dir, redirect to dir path

  *optional*
  ?encoding = default utf8

  return:
  content of specified file
*/
var getFile = function (req, res, next) {
  var filePath = decodeURI(url.parse(req.url).pathname);
  var encoding = req.query.encoding || 'utf8';
  fileDriver.readFile(filePath, encoding, function(err, data) {
    if (err) {
      // this this is a dir, redirect to dir path
      if (err.code === 'EISDIR') {
        var originalUrl = url.parse(req.originalUrl);
        originalUrl.pathname += '/';
        var target = url.format(originalUrl);
        res.statusCode = 303;
        res.setHeader('Location', target);
        res.end('Redirecting to ' + target);
        return;
      }
      next(err);
      return;
    }

    res.set('Content-Type', mime.lookup(filePath));
    res.send(200, data);
  });
};

/* POST
  /path/to/file/or/dir
  creates or overwrites file
  creates dir if it does not exisit.
  renames or moves file if newPath exists
  *optional*
  body.newPath = if exist, move/rename file to this location.
  body.clobber = if true will overwrite dest files (default false)
  body.mkdirp = if true will create path to new locatiin (default false)

  body.mode = permissons of file (defaults: file 438(0666) dir 511(0777))
  body.encoding = default utf8

  returns: modified resource
  {
    "name" : "file1", // name of dir or file
    "path" : "/path/to/file", // path to dir or file
    "dir" : false // true if directory
  }
*/
var postFileOrDir = function (req, res, next) {
  var dirPath =  decodeURI(url.parse(req.url).pathname);
  var isDir = dirPath.substr(-1) == '/';
  var options = {};
  // move/rename if newPath exists
  if (req.body.newPath) {
    options.clobber = req.body.clobber || false;
    options.mkdirp = req.body.mkdirp || false;
    fileDriver.move(dirPath, req.body.newPath, options,
      sendCode(200, req, res, next, formatOutData(dirPath)));
    return;
  }

  if (isDir) {
    var mode = req.body.mode || 511;
    fileDriver.mkdir(dirPath, mode,
      sendCode(201, req, res, next, formatOutData(dirPath)));
  } else {
    options.encoding = req.body.encoding  || 'utf8';
    options.mode = req.body.mode  || 438;
    var data = req.body.content || '';
    fileDriver.writeFile(dirPath, data, options,
      sendCode(201, req, res, next, formatOutData(dirPath)));
  }
};

/* PUT
  /path/to/file/or/dir
  make file or dir

  *optional*
  body.mode = permissons of file (438 default 0666 octal)
  body.encoding = default utf8

  returns: modified resource
  {
    "name" : "file1", // name of dir or file
    "path" : "/path/to/file", // path to dir or file
    "dir" : false // true if directory
  }
*/
var putFileOrDir = function (req, res, next) {
  var dirPath =  decodeURI(url.parse(req.url).pathname);
  var isDir = dirPath.substr(-1) == '/';
  var options = {};

  if (isDir) {
    var mode = req.body.mode || 511;
    fileDriver.mkdir(dirPath, mode,
      sendCode(201, req, res, next, formatOutData(dirPath)));
  } else {
    options.encoding = req.body.encoding  || 'utf8';
    options.mode = req.body.mode  || 438;
    var data = req.body.content || '';
    fileDriver.writeFile(dirPath, data, options,
      sendCode(201, req, res, next, formatOutData(dirPath)));
  }
};

/* DEL
  /path/to/dir/
  deletes dir
  *optional*
  body.clobber = will remove non-empty dir (defaut: false)

  return:
  {}
*/
var delDir = function (req, res, next) {
  var dirPath =  decodeURI(url.parse(req.url).pathname);
  var clobber = req.body.clobber  || false;
  fileDriver.rmdir(dirPath, clobber,  sendCode(200, req, res, next, formatOutData(dirPath)));
};

/* DEL
  /path/to/file
  deletes file

  return:
  {}
*/
var delFile = function (req, res, next) {
  var dirPath =  decodeURI(url.parse(req.url).pathname);
  fileDriver.unlink(dirPath, sendCode(200, req, res, next, formatOutData(dirPath)));
};

// Helpers

// formats out data based on client spec.
var formatOutData = function (filepath) {
  var out = filepath;
  if (modifyOut) {
    out = modifyOut(out);
  }
  return out;
};

var sendCode = function(code, req, res, next, out) {
  return function (err) {
    if (err) {
      return next(err);
    }
    res.send(code, out);
  };
};

module.exports = fileserver;