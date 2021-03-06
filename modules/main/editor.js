angular.module('main').directive('editor', [
  'consoleInterface',
  '$parse', 
  '$templateCache', 
  '$compile', 
  '$interval', function(
  consoleInterface,
  $parse,
  $templateCache,
  $compile,
  $interval) {  

  function link(scope, element, attr) {      

    ////////////////////////////////////////////
    // Create the CodeMirror editor instance. //
    ////////////////////////////////////////////

    var initOptions = { value: scope.$eval(attr.code) || '' }
    Object.keys(attr).forEach(function(attribute) {
      if(attribute.slice(0, 4) !== 'init') return
      var key = attribute[4].toLowerCase() + attribute.slice(5)
      initOptions[key] = attr[attribute]
    })
    
    var editor = CodeMirror(element[0], initOptions)
    
    if(attr.hasOwnProperty('element'))
      $parse(attr.element).assign(scope, editor)

    var pending = {}
      , template = $compile($templateCache.get(attr.widgetTemplate))
      , widgetElement = template(scope)[0]
      , widgetActiveElement
      , markers = {}
      , lineWidgets = {}     
      , bookmarks = {}
      , isRebuildingEditor = false

    var rebuildEditor = function() {

      // Focus.
      if(pending.focus) {
        var focus = scope.$eval(attr.focus)
        if(focus) editor.focus()
        delete pending.focus
      }
      
      // Code.
      if(pending.code) {
        var code = scope.$eval(attr.code) || ''
        if(code !== editor.getValue()) {
          editor.setValue(code)
          editor.clearHistory()
          pending.line = true
          pending.ch = true
        }
        delete pending.code
      }
      
      // Cursor.
      var oldCursor = editor.getCursor()
        , line = pending.line ? scope.$eval(attr.line) : oldCursor.line
        , ch = pending.ch ? scope.$eval(attr.ch) || 0 : oldCursor.ch
        , cursorUpdating = line !== oldCursor.line || ch !== oldCursor.ch
        
      if(cursorUpdating) {

        // http://codemirror.977696.n3.nabble.com/Is-it-possible-to-scroll-to-a-line-so-that-it-is-in-the-middle-of-window-td4025123.html
        var coords = editor.charCoords({ line: line, ch: 0 }, 'local')
          , y = coords.top
          , halfHeight = editor.getScrollerElement().offsetHeight / 2 
        editor.scrollTo(0, y - halfHeight * 0.75)
        
        editor.setCursor({ line: line, ch: ch })

        // Update bookmarks in case the viewport changes.        
        pending.bookmarks = true
        
        delete pending.line
        delete pending.ch
      }
      
      editor.operation(function() {

        // Widget.
        if(pending.widget) {

          if(widgetActiveElement) {
            widgetActiveElement.parentNode.removeChild(widgetActiveElement)
            widgetActiveElement = null
          }
  
          var widgetKey = scope.$eval(attr.widgetKey)
            , line = scope.$eval(attr.widgetLine) || 0
            , ch = scope.$eval(attr.widgetCh) || 0
            , pos = { line: line, ch: ch }
            
          if(widgetKey) {
            editor.addWidget(pos, widgetElement)
            widgetActiveElement = widgetElement
          }

          delete pending.widget
        }
        
        // Markers.
        if(pending.markers) {
        
          var newMarkers = scope.$eval(attr.markers) || {}
          
          Object.keys(markers).forEach(function(key) {
  
            if(newMarkers.hasOwnProperty(key)) return
            
            // Delete marker.
            markers[key].clear()
            delete markers[key]          
          })
          
          Object.keys(newMarkers).forEach(function(key) {
            
            if(markers.hasOwnProperty(key)) return
            
            // Add marker.
            var marker = newMarkers[key]
            markers[key] = editor.markText(
              marker.from, 
              marker.to, 
              marker.options) 
          })
          
          delete pending.markers
        }
        
        // Line widgets.
        if(pending.lineWidgets) {
  
          var newLineWidgets = scope.$eval(attr.lineWidgets) || {}
          
          Object.keys(lineWidgets).forEach(function(key) {
  
            if(newLineWidgets.hasOwnProperty(key)) return
            
            // Delete line widget.
            lineWidgets[key].widget.clear()
            lineWidgets[key].scope.$destroy()
            delete lineWidgets[key]          
          })
          
          Object.keys(newLineWidgets).forEach(function(key) {
            
            if(lineWidgets.hasOwnProperty(key)) return
            
            // Add line widget.
            var lineWidget = newLineWidgets[key]
              , template = $compile($templateCache.get(lineWidget.template))
              , lineWidgetScope = scope.$new()
              
            lineWidgetScope.model = lineWidget.model
            
            var lineWidgetElement = template(lineWidgetScope)[0]
              
            lineWidgets[key] = {
              scope: lineWidgetScope,
              widget: editor.addLineWidget(
                lineWidget.line,
                lineWidgetElement,
                lineWidget.options)
            }
            
            lineWidgetScope.$digest()
          })
          
          delete pending.lineWidgets
        }
        
        // Bookmarks.
        if(pending.bookmarks) {
  
          var viewport = editor.getViewport()
            , newBookmarks = scope.$eval(attr.bookmarks) || {}
            , operations = 0
  
          for(var key in bookmarks) {
  
            var isInNewBookmarks = newBookmarks.hasOwnProperty(key)
              , bookmark = bookmarks[key]
              , loc = bookmark.scope.model.loc
              , isAbove = loc.to.line <= viewport.to
              , isBelow = loc.to.line >= viewport.from
              , isInViewport = isAbove && isBelow
  
            if(isInNewBookmarks && isInViewport) continue
            
            // Delete bookmark.
            bookmark.destroy()
          }
  
          for(var key in newBookmarks) {
            
            var existingBookmark = bookmarks[key]
  
            if(existingBookmark) {
                  
              // Update bookark.
              bookmarks[key].scope.model = newBookmarks[key]
              bookmarks[key].scope.$digest()
              
            } else {
  
              var log = newBookmarks[key]
              if(
                log.loc.to.line <= viewport.to &&
                log.loc.to.line >= viewport.from) {
                  
                // Add bookmark.
                var bookmarkScope = scope.$new()
                  , pos = { line: log.loc.to.line, ch: log.loc.to.column }
                  , template = $compile($templateCache.get(attr.bookmarkTemplate))
                  , widget = template(bookmarkScope)[0]
                  , options = angular.extend({ widget: widget, insertLeft: 1 }, log)
      
                bookmarkScope.model = log
                bookmarkScope.key = key
      
                bookmarks[key] = {
                  scope: bookmarkScope,
                  textMarker: editor.setBookmark(pos, options),
                  widget: widget,
                  destroy: function() {
                    delete bookmarks[this.scope.key];
                    this.scope.$destroy()
                    this.textMarker.clear()
                  }
                }
                
                bookmarkScope.$digest()
              }
            }
          }
          
          delete pending.bookmarks
        }
      })

      if(cursorUpdating) {
        
        // Workaround to show full bookmark.
        editor.setCursor({ line: line, ch: ch + 1 })
        editor.setCursor({ line: line, ch: ch })
      }
    }

    function rebuildEditorOperation() {
      isRebuildingEditor = true
      rebuildEditor()
      isRebuildingEditor = false
    }    
    
    var rebuildEditorDebounced = _.debounce(
      rebuildEditorOperation, 50)

    function watch(prop, uiComponent, fullWatch) {
      scope.$watch(prop, function(newValue, oldValue) {
        if(newValue === oldValue) return
        pending[uiComponent] = true
        rebuildEditorDebounced()
      }, fullWatch)
    } 

    // Bind read-only.
    if(attr.readOnly) {
      scope.$watch(attr.readOnly, function(newValue) {
        console.log('readOnly', newValue)
        editor.setOption('readOnly', newValue)
      })
    }
    
    // Bind focus.     
    if(attr.focus) {

      editor.on('focus', function() {
        $parse(attr.focus).assign(scope, true)
        if(!scope.$$phase) scope.$digest()
      })
      
      editor.on('blur', function() {
        $parse(attr.focus).assign(scope, false)
        if(!scope.$$phase) scope.$digest()
      })
      
      watch(attr.focus, 'focus')
    }
    
    // Bind code.        
    if(attr.code) {

      editor.on('change', function() {
        if(isRebuildingEditor) return
        $parse(attr.code).assign(scope, editor.getValue())
        if(attr.userCodeEdit) scope.$broadcast(attr.userCodeEdit)
        if(!scope.$$phase) scope.$digest()
      })

      watch(attr.code, 'code')  
    }
    
    // Bind cursor.
    editor.on('cursorActivity', function() {
      if(isRebuildingEditor) return
      var cursor = editor.getCursor()
      if(attr.line) $parse(attr.line).assign(scope, cursor.line)
      if(attr.ch) $parse(attr.ch).assign(scope, cursor.ch)
      if((attr.line || attr.ch) && !scope.$$phase) scope.$digest()
    })
    
    if(attr.line) watch(attr.line, 'line')
    if(attr.ch) watch(attr.ch, 'ch')

    // Bind widget.
    if(attr.widgetTemplate) {
      watch(attr.widgetKey, 'widget')
      watch(attr.widgetLine, 'widget')
      watch(attr.widgetCh, 'widget')
    }

    // Bind markers.
    if(attr.markers)
      watch(attr.markers, 'markers', true)

    // Bind line widgets.    
    if(attr.lineWidgets)
      watch(attr.lineWidgets, 'lineWidgets', true)
      
    // Bind bookmarks.
    if(attr.bookmarks) {
      
      editor.on('viewportChange', function() {
        if(isRebuildingEditor) return
        pending.bookmarks = true
        rebuildEditorDebounced()
      })
      
      watch(attr.bookmarks, 'bookmarks', true)
    }
    
  }
  
  return { link: link }
}])
