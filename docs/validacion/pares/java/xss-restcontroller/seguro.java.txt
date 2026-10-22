import org.springframework.web.bind.annotation.*;
import org.springframework.web.util.HtmlUtils;

@RestController
public class BusquedaController {
    @GetMapping("/buscar")
    public String buscar(@RequestParam String q) {
        return "<p>Resultados para <b>" + HtmlUtils.htmlEscape(q) + "</b></p>";
    }
}
