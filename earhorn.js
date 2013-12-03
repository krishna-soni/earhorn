(function(context) {

  //////////////
  // earhorn$ //
  //////////////

  // Set up settings object.
  var settings = JSON.parse(localStorage.getItem('earhorn-settings'))

  if(!settings.hasOwnProperty('instrumentation')) {
    
    settings.instrumentation = {
      maxElements: 3,
      maxKeys: 200,
      depth: 2,
      maxStringLength: 50,
      bufferSize: 100,
      flushInterval: 25,
      handleErrors: true
    }
    
    localStorage.setItem('earhorn-settings', JSON.stringify(settings))
  }

  // Subscribe to localStorage events.
  window.addEventListener('storage', onStorage, false)
  
  function onStorage(evt) {
    
    console.log('server receieved message')

    if(evt.key === 'earhorn-settings')
      return settings = earhorn$.settings = JSON.parse(evt.newValue)

    if(evt.key !== 'earhorn-listener')
      return

    var record = JSON.parse(evt.newValue)

    if(!scripts.hasOwnProperty(record.script)) 
      return

    if(record.type === 'announcement-request')
      announce(record.script)      

    else if(record.type === 'edit') {

      localStorage.setItem('earhorn-script-' + record.script, record.body)
      // console.log('applying edit', record.script, record.body)
      if(record.reload) // TODO: could do hot code-swapping instead ...
        location.reload(true)

    } else if(record.type === 'reset') {

      localStorage.removeItem('earhorn-script-' + record.script)
      if(record.reload) // TODO: could do hot code-swapping instead ...
        location.reload(true)
    }
  }

  var scripts = {}

  function announce(name) {
    send({
      type: 'announcement',
      script: name,
      modified: scripts[name].modified,
      body: scripts[name].body,
      parseError: scripts[name].parseError
    })
  }

  function earhorn$(name, fn) {
  
    // Get the function body.
    var sessionFnKey = 'earhorn-script-' + name
      , modified = localStorage.hasOwnProperty(sessionFnKey)
      , fnStr = fn.toString()
      
    var body
    
    if(modified) {
      
      body = localStorage.getItem(sessionFnKey)
      console.log('using copy of code in localStorage for', name)
    } else {
      
      body = fnStr.substring(
      fnStr.indexOf('{') + 1,
      fnStr.lastIndexOf('}'))
      
      while(body[0] === '\n') body = body.slice(1)
    }
  
    function isExpression(type) {
      return type.indexOf('Expression', type.length - 'Expression'.length) >= 0
    }
    
    var instrumentedExpressions = [
      'NewExpression',
      'CallExpression',
      'AssignmentOperator',
      'ConditionalExpression',
      'LogicalExpression',
      'UpdateExpression',
      'UnaryExpression',
      'PostfixExpression',
      'BinaryExpression'
      // TODO function arguments
      // TODO CatchClause
      // TODO ForStatement
      // TODO ForInStatement
    ]
    
    var instrumentedParentTypes = [
      'ExpressionStatement',
      'SequenceExpression',
      'ReturnStatement',
      'BinaryExpression',
      'ThrowStatement'
    ]
    
    var skippedMemberExpressionParents = [
      'AssignmentExpression',
      'UnaryExpression',
      'UpdateExpression',
      'CallExpression',
      'NewExpression'
    ]
    
    // Wrap Identifiers with calls to our logger, eh$(...)
    
    scripts[name] = {
      body: body,
      modified: modified
    }
    
    var instrumentedCode
    try {
      instrumentedCode = falafel(body, { loc: true, raw: true }, visitNode).toString()
      scripts[name].parseError = null
      announce(name)
    } catch(err) {
      console.error(err, body)
      
      var e = err.toString()
        , colon1 = e.indexOf(': ')
        , colon2 = e.indexOf(': ', colon1 + 1)
        , message = e.substring(colon2 + ': '.length)
      
      scripts[name].parseError = {
        line: err.lineNumber - 1,
        ch: err.column,
        message: message
      }
      announce(name)
      throw err
    }
      
    function visitNode(node) {
     
      if(!node.parent || node.type === 'Literal') return
      
      if(settings.instrumentation.handleErrors &&
        node.parent.type === 'BlockStatement' && node.parent.parent && (
        node.parent.parent.type === 'FunctionDeclaration' || 
        node.parent.parent.type === 'FunctionExpression')) {
        
        if(node.parent.body[0] === node) {
          node.update('var eh$log; try {' + node.source())
        }
        
        if(node.parent.body[node.parent.body.length - 1] === node) {
          node.update(node.source() + '} catch(err) { eh$("' + name +  '",eh$loc,err); throw err; }')
        }
        
        return
      }

      if(
        (node.parent.type === 'CallExpression' && 
          node !== node.parent.callee) ||
        (node.parent.type === 'IfStatement' && 
          node === node.parent.test) ||
        (node.parent.type === 'WhileStatement' && 
          node === node.parent.test) ||
        (node.parent.type === 'DoWhileStatement' && 
          node === node.parent.test) ||
        (node.parent.type === 'SwitchCase' && 
          node === node.parent.test) ||
        (node.parent.type === 'SwitchStatement' && 
          node === node.parent.discriminant) ||
        (node.parent.type === 'MemberExpression' && 
          node === node.parent.object) ||
        instrumentedExpressions.indexOf(node.type) >= 0 ||
        (instrumentedParentTypes.
          indexOf(node.parent.type) >= 0) ||
        (node.type === 'MemberExpression' && 
          skippedMemberExpressionParents.indexOf(node.parent.type) < 0)) {
          
        node.update('eh$("' +
          name + '",eh$loc="' +
          (node.loc.start.line - 1) + ',' +
          node.loc.start.column + ',' +
          (node.loc.end.line - 1) + ',' +
          node.loc.end.column + '",' +
          node.source() +
        ')')
      }
    }
  
    console.log(instrumentedCode)
  
    instrumentedCode += '//@ sourceURL=' + name
    
    try {
      return new Function(instrumentedCode)
    } catch(e) {
      console.error(instrumentedCode)
      return new Function(instrumentedCode)
    }
  }
  
  earhorn$.settings = settings
  
  function makeSerializable(obj, depth) {
    
    if(obj === null)
      return { type: 'null' }
      
    if(obj === void 0)
      return { type: 'undefined' }
    
    var type = Object.prototype.toString.call(obj)

    if(type === '[object Function]')
      return { type: 'Function', name: obj.name }
      
    if(type === '[object Number]')
      return { type: 'Number', value: obj }
    
    if(type === '[object Boolean]')
      return { type: 'Boolean', value: obj }
    
    if(type === '[object String]') {
      return {
        type: 'String',
        clipped: obj.length > settings.instrumentation.maxStringLength,
        value: obj.substring(0, settings.instrumentation.maxStringLength)
      }
    }
    
    if(type === '[object Array]') {

      var elements = depth <= 1 ? [] :
        obj.slice(0, settings.instrumentation.maxElements).map(function(x) {
          return makeSerializable(x, depth - 1)
        })

      return {
        type: 'Array',
        length: obj.length,
        elements: elements
      }
    }

    // Object
    var result = {
      type: 'Object',
      constructor: obj.constructor ? obj.constructor.name : null,
      complete: true,
      properties: { }
    }

    if(depth > 1 && obj !== window) {

      var keys = settings.instrumentation.maxKeys

      for(var key in obj) {

        if(keys --> 0) {
          try {
            var value = obj[key]
            result.properties[key] = makeSerializable(obj[key], depth - 1)
          } catch(err) {
            result.properties[key] = makeSerializable(err, depth - 1)
          }
        } else {
          result.complete = false
          break
        }
      }
    }
      
    return result
  }
  
  var buffer = []
  
  // Log and return the value.
  function eh$(script, loc, val) {
  
    send({
      type: 'log',
      script: script,
      loc: loc,
      val: makeSerializable(val, settings.instrumentation.depth)
    })

    return val
  }
  
  // Setting an initial event seems to be necessary in some cases
  // to get the localStorage event to fire correctly for subsequent events
  // in listening windows.
  localStorage.setItem('earhorn-log', '[]')
  
  function send(message) {

    buffer.push(message)
    
    if(buffer.length > settings.instrumentation.bufferSize)
      flush()
  }
  
  function flush() {
    if(!buffer.length) return

    localStorage.setItem('earhorn-log', JSON.stringify(buffer))
    buffer = []
  }
  
  function checkBuffer() {
    flush()    
    setTimeout(checkBuffer, settings.instrumentation.flushInterval)
  }
  
  setTimeout(checkBuffer, settings.instrumentation.flushInterval)
  
  context.earhorn$ = earhorn$
  context.eh$ = eh$

})(this)