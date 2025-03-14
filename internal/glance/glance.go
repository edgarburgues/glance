package glance

import (
    "bytes"
    "context"
    "fmt"
    "html/template"
    "log"
    "net/http"
    "path/filepath"
    "strconv"
    "strings"
    "sync"
    "time"
    "github.com/NYTimes/gziphandler"
)

var (
    pageTemplate           = mustParseTemplate("page.html", "document.html")
    pageContentTemplate    = mustParseTemplate("page-content.html")
    pageThemeStyleTemplate = mustParseTemplate("theme-style.gotmpl")
)

type application struct {
    Version          string
    Config           config
    ParsedThemeStyle template.HTML

    slugToPage map[string]*page
    widgetByID map[uint64]widget
}

func newApplication(config *config) (*application, error) {
    app := &application{
        Version:    buildVersion,
        Config:     *config,
        slugToPage: make(map[string]*page),
        widgetByID: make(map[uint64]widget),
    }

    app.slugToPage[""] = &config.Pages[0]

    providers := &widgetProviders{
        assetResolver: app.AssetPath,
    }

    var err error
    app.ParsedThemeStyle, err = executeTemplateToHTML(pageThemeStyleTemplate, &app.Config.Theme)
    if err != nil {
        return nil, fmt.Errorf("parsing theme style: %v", err)
    }

    for p := range config.Pages {
        page := &config.Pages[p]
        page.PrimaryColumnIndex = -1

        if page.Slug == "" {
            page.Slug = titleToSlug(page.Title)
        }

        app.slugToPage[page.Slug] = page

        for c := range page.Columns {
            column := &page.Columns[c]

            if page.PrimaryColumnIndex == -1 && column.Size == "full" {
                page.PrimaryColumnIndex = int8(c)
            }

            for w := range column.Widgets {
                widget := column.Widgets[w]
                app.widgetByID[widget.GetID()] = widget

                widget.setProviders(providers)
            }
        }
    }

    config = &app.Config

    config.Server.BaseURL = strings.TrimRight(config.Server.BaseURL, "/")
    config.Theme.CustomCSSFile = app.transformUserDefinedAssetPath(config.Theme.CustomCSSFile)

    if config.Branding.FaviconURL == "" {
        config.Branding.FaviconURL = app.AssetPath("favicon.png")
    } else {
        config.Branding.FaviconURL = app.transformUserDefinedAssetPath(config.Branding.FaviconURL)
    }

    config.Branding.LogoURL = app.transformUserDefinedAssetPath(config.Branding.LogoURL)

    return app, nil
}

func (p *page) updateOutdatedWidgets() {
    // now := time.Now()

    var wg sync.WaitGroup
    context := context.Background()

    for c := range p.Columns {
        for w := range p.Columns[c].Widgets {
            wid := p.Columns[c].Widgets[w]
    
            wg.Add(1)
            go func(x widget) {
                defer wg.Done()
                x.update(context)
            }(wid)
        }
    }

    wg.Wait()
}

func (a *application) transformUserDefinedAssetPath(path string) string {
    if strings.HasPrefix(path, "/assets/") {
        return a.Config.Server.BaseURL + path
    }
    return path
}

type pageTemplateData struct {
    App                 *application
    Page                *page
    PageRenderedContent template.HTML
}

func (a *application) handlePageRequest(w http.ResponseWriter, r *http.Request) {
    pageSlug := strings.TrimPrefix(r.URL.Path, "/")
    pageSlug = strings.Trim(pageSlug, "/")

    page, exists := a.slugToPage[pageSlug]
    if !exists {
        a.handleNotFound(w, r)
        return
    }

    pageData := pageTemplateData{
        Page: page,
        App:  a,
    }
    page.updateOutdatedWidgets()

    var pageContent bytes.Buffer
    err := pageContentTemplate.Execute(&pageContent, pageData)
    if err != nil {
        w.WriteHeader(http.StatusInternalServerError)
        w.Write([]byte(err.Error()))
        return
    }

    pageData.PageRenderedContent = template.HTML(pageContent.String())

    var responseBytes bytes.Buffer
    err = pageTemplate.Execute(&responseBytes, pageData)
    if err != nil {
        w.WriteHeader(http.StatusInternalServerError)
        w.Write([]byte(err.Error()))
        return
    }

    w.Write(responseBytes.Bytes())
}

func (a *application) handleNotFound(w http.ResponseWriter, _ *http.Request) {
    // TODO: add proper not found page
    w.WriteHeader(http.StatusNotFound)
    w.Write([]byte("Page not found"))
}

func (a *application) handleWidgetRequest(w http.ResponseWriter, r *http.Request) {
    widgetValue := strings.TrimPrefix(r.URL.Path, "/api/widgets/")
    parts := strings.SplitN(widgetValue, "/", 2)

    if len(parts) == 0 {
        a.handleNotFound(w, r)
        return
    }

    widgetID, err := strconv.ParseUint(parts[0], 10, 64)
    if err != nil {
        a.handleNotFound(w, r)
        return
    }

    widget, exists := a.widgetByID[widgetID]

    if !exists {
        a.handleNotFound(w, r)
        return
    }

    widget.handleRequest(w, r)
}

func (a *application) AssetPath(asset string) string {
    return a.Config.Server.BaseURL + "/static/" + staticFSHash + "/" + asset
}

func (a *application) server() (func() error, func() error) {
    mux := http.NewServeMux()

    mux.HandleFunc("/", a.handlePageRequest)

    // mux.HandleFunc("/api/pages/", a.handlePageContentRequest) // <== Not used anymore with SSR

    mux.HandleFunc("/api/widgets/", a.handleWidgetRequest)
    mux.HandleFunc("/api/healthz", func(w http.ResponseWriter, _ *http.Request) {
        w.WriteHeader(http.StatusOK)
    })

    mux.Handle(
        "GET /static/"+staticFSHash+"/{path...}",
        http.StripPrefix("/static/"+staticFSHash, fileServerWithCache(http.FS(staticFS), 24*time.Hour)),
    )

    var absAssetsPath string
    if a.Config.Server.AssetsPath != "" {
        absAssetsPath, _ = filepath.Abs(a.Config.Server.AssetsPath)
        assetsFS := fileServerWithCache(http.Dir(a.Config.Server.AssetsPath), 2*time.Hour)
        mux.Handle("/assets/{path...}", http.StripPrefix("/assets/", assetsFS))
    }

    server := http.Server{
        Addr:    fmt.Sprintf("%s:%d", a.Config.Server.Host, a.Config.Server.Port),
        Handler: mux, 
    }

    start := func() error {
        a.Config.Server.StartedAt = time.Now()
        log.Printf("Starting server on %s:%d (base-url: \"%s\", assets-path: \"%s\")\n",
            a.Config.Server.Host,
            a.Config.Server.Port,
            a.Config.Server.BaseURL,
            absAssetsPath,
        )
        gz := gziphandler.GzipHandler(server.Handler)
        server.Handler = gz

        if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
            return err
        }

        return nil
    }

    stop := func() error {
        return server.Close()
    }
    
    return start, stop
}
